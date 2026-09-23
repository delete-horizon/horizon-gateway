use crate::model::api_log::{ApiLogBodyFile, ApiLogEntry, ApiLogSearchHit, ApiLogSummary};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const BODY_LOG_CAP_BYTES: usize = 2 * 1024 * 1024;
pub const FTS_TEXT_CAP_BYTES: usize = 256 * 1024;

struct SearchIndexTask {
    date: String,
    entry: ApiLogEntry,
    indexed_params: Vec<String>,
}

enum IndexCommand {
    Task(SearchIndexTask),
    Flush(std::sync::mpsc::SyncSender<()>),
}

#[derive(Clone)]
pub struct ApiLogService {
    log_dir: PathBuf,
    write_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    today_cache: Arc<Mutex<TodayCache>>,
    indexed_params: Arc<Mutex<HashSet<String>>>,
    index_tx: std::sync::mpsc::Sender<IndexCommand>,
}

struct TodayCache {
    date: String,
    entries: Vec<ApiLogSummary>,
}

impl ApiLogService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let log_dir = app_data_dir.join("api_logs");
        if !log_dir.exists() {
            let _ = fs::create_dir_all(&log_dir);
        }
        let _ = fs::create_dir_all(log_dir.join("bodies"));
        let _ = fs::create_dir_all(log_dir.join("search"));

        let indexed_params = load_indexed_params(&log_dir);
        let today = today_date_string();
        let mut entries = read_summaries_from_disk(&log_dir, &today);
        // disk returns newest-first; cache stores oldest-first for append
        entries.reverse();

        let (index_tx, index_rx) = std::sync::mpsc::channel::<IndexCommand>();
        let worker_log_dir = log_dir.clone();

        std::thread::Builder::new()
            .name("api-log-indexer".to_string())
            .spawn(move || {
                let mut batch: Vec<SearchIndexTask> = Vec::new();
                loop {
                    match index_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                        Ok(IndexCommand::Task(task)) => {
                            batch.push(task);
                            while batch.len() < 50 {
                                match index_rx.try_recv() {
                                    Ok(IndexCommand::Task(next)) => batch.push(next),
                                    Ok(IndexCommand::Flush(ack)) => {
                                        flush_index_batch(&worker_log_dir, &mut batch);
                                        let _ = ack.send(());
                                        break;
                                    }
                                    Err(_) => break,
                                }
                            }
                            if batch.len() >= 50 {
                                flush_index_batch(&worker_log_dir, &mut batch);
                            }
                        }
                        Ok(IndexCommand::Flush(ack)) => {
                            flush_index_batch(&worker_log_dir, &mut batch);
                            let _ = ack.send(());
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if !batch.is_empty() {
                                flush_index_batch(&worker_log_dir, &mut batch);
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            flush_index_batch(&worker_log_dir, &mut batch);
                            break;
                        }
                    }
                }
            })
            .expect("failed to spawn api-log-indexer thread");

        Self {
            log_dir,
            write_locks: Arc::new(Mutex::new(HashMap::new())),
            today_cache: Arc::new(Mutex::new(TodayCache {
                date: today,
                entries,
            })),
            indexed_params: Arc::new(Mutex::new(indexed_params)),
            index_tx,
        }
    }

    pub fn flush_search_index(&self) {
        let (tx, rx) = std::sync::mpsc::sync_channel(0);
        if self.index_tx.send(IndexCommand::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
        }
    }

    fn date_lock(&self, date: &str) -> Arc<Mutex<()>> {
        let mut map = self.write_locks.lock().unwrap();
        map.entry(date.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn ensure_today_cache(&self) {
        let today = today_date_string();
        let mut cache = self.today_cache.lock().unwrap();
        if cache.date != today {
            let mut entries = read_summaries_from_disk(&self.log_dir, &today);
            // disk returns newest-first; store oldest-first for append
            entries.reverse();
            cache.date = today;
            cache.entries = entries;
        }
    }

    /// Persist a captured log (meta + optional body sidecar + search index).
    pub fn save_log(&self, entry: &ApiLogEntry) {
        let date_str = date_from_timestamp(&entry.timestamp);
        let lock = self.date_lock(&date_str);
        let _guard = lock.lock().unwrap();

        let has_payload = entry.request_headers.is_some()
            || entry.request_body.is_some()
            || entry.response_headers.is_some()
            || entry.response_body.is_some();

        let mut entry = entry.clone();
        entry.request_body = truncate_opt(entry.request_body.take(), BODY_LOG_CAP_BYTES);
        entry.response_body = truncate_opt(entry.response_body.take(), BODY_LOG_CAP_BYTES);
        entry.has_bodies = has_payload;

        if has_payload {
            let body_dir = self.log_dir.join("bodies").join(&date_str);
            let _ = fs::create_dir_all(&body_dir);
            let body_path = body_dir.join(format!("{}.json", entry.id));
            let body_file = ApiLogBodyFile {
                request_headers: entry.request_headers.clone(),
                request_body: entry.request_body.clone(),
                response_headers: entry.response_headers.clone(),
                response_body: entry.response_body.clone(),
            };
            if let Ok(json) = serde_json::to_string(&body_file) {
                let _ = fs::write(body_path, json);
            }
        }

        let index_entry = entry.clone();
        let meta = ApiLogSummary {
            id: index_entry.id.clone(),
            timestamp: index_entry.timestamp.clone(),
            method: index_entry.method.clone(),
            url: index_entry.url.clone(),
            host: index_entry.host.clone(),
            path: index_entry.path.clone(),
            status_code: index_entry.status_code,
            has_bodies: has_payload,
            is_mocked: index_entry.is_mocked,
        };

        let meta_path = self.log_dir.join(format!("{date_str}.meta.jsonl"));
        let idx_path = self.log_dir.join(format!("{date_str}.idx"));

        let offset = meta_path.metadata().map(|m| m.len()).unwrap_or(0);

        if let Ok(json) = serde_json::to_string(&meta) {
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&meta_path)
            {
                let _ = writeln!(file, "{json}");
            }
            if let Ok(mut idx) = OpenOptions::new().create(true).append(true).open(&idx_path) {
                let _ = writeln!(idx, "{}\t{offset}", meta.id);
            }
        }

        // Today cache
        {
            self.ensure_today_cache();
            let mut cache = self.today_cache.lock().unwrap();
            if cache.date == date_str {
                cache.entries.push(meta.clone());
            }
        }

        // Search index via background batch worker — non-blocking
        let params_snapshot: Vec<String> = self
            .indexed_params
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect();
        let _ = self.index_tx.send(IndexCommand::Task(SearchIndexTask {
            date: date_str,
            entry: index_entry,
            indexed_params: params_snapshot,
        }));
    }

    pub fn list_dates(&self) -> Vec<String> {
        let mut dates = HashSet::new();
        if let Ok(entries) = fs::read_dir(&self.log_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                if let Some(date) = name.strip_suffix(".meta.jsonl") {
                    dates.insert(date.to_string());
                } else if let Some(date) = name.strip_suffix(".jsonl") {
                    if !date.contains('.') {
                        dates.insert(date.to_string());
                    }
                }
            }
        }
        let mut dates: Vec<_> = dates.into_iter().collect();
        dates.sort();
        dates.reverse();
        dates
    }

    pub fn get_logs(
        &self,
        date: &str,
        domain_filter: Option<String>,
        method_filter: Option<String>,
        host_filter: Option<String>,
        exact_match: bool,
    ) -> Vec<ApiLogEntry> {
        let summaries =
            self.get_summaries(date, domain_filter, method_filter, host_filter, exact_match);
        summaries.into_iter().map(|s| s.to_list_entry()).collect()
    }

    pub fn get_summaries(
        &self,
        date: &str,
        domain_filter: Option<String>,
        method_filter: Option<String>,
        host_filter: Option<String>,
        exact_match: bool,
    ) -> Vec<ApiLogSummary> {
        self.ensure_today_cache();
        let today = today_date_string();

        let mut logs = if date == today {
            let cache = self.today_cache.lock().unwrap();
            if cache.date == today {
                cache.entries.clone()
            } else {
                read_summaries_from_disk(&self.log_dir, date)
            }
        } else {
            read_summaries_from_disk(&self.log_dir, date)
        };

        logs.retain(|entry| {
            matches_filters(
                entry,
                domain_filter.as_deref(),
                method_filter.as_deref(),
                host_filter.as_deref(),
                exact_match,
            )
        });

        // Newest first
        if date == today {
            logs.reverse();
        }
        logs
    }

    pub fn get_log_by_id(&self, id: &str, date_hint: Option<&str>) -> Option<ApiLogEntry> {
        let mut dates = Vec::new();
        if let Some(d) = date_hint {
            dates.push(d.to_string());
        }
        for d in self.list_dates() {
            if !dates.iter().any(|x| x == &d) {
                dates.push(d);
            }
        }
        // Cap search window
        dates.truncate(14);

        for date in dates {
            if let Some(mut entry) = load_meta_by_id(&self.log_dir, &date, id) {
                if entry.has_bodies {
                    if let Some(body) = load_body_file(&self.log_dir, &date, id) {
                        entry.request_headers = body.request_headers;
                        entry.request_body = body.request_body;
                        entry.response_headers = body.response_headers;
                        entry.response_body = body.response_body;
                    } else {
                        // Legacy full-line jsonl may already include bodies via load_meta_by_id
                    }
                }
                return Some(entry);
            }
        }
        None
    }

    pub fn clear_logs(&self, date: Option<String>) -> Result<(), String> {
        if let Some(d) = date {
            let lock = self.date_lock(&d);
            let _guard = lock.lock().unwrap();
            clear_date_files(&self.log_dir, &d)?;
            let mut cache = self.today_cache.lock().unwrap();
            if cache.date == d {
                cache.entries.clear();
            }
        } else {
            // Clear all dates
            for d in self.list_dates() {
                let lock = self.date_lock(&d);
                let _guard = lock.lock().unwrap();
                let _ = clear_date_files(&self.log_dir, &d);
            }
            // Also remove leftover legacy files / dirs
            if let Ok(entries) = fs::read_dir(&self.log_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                        if name.ends_with(".jsonl")
                            || name.ends_with(".idx")
                            || name == "indexed_params.json"
                        {
                            let _ = fs::remove_file(path);
                        }
                    }
                }
            }
            let bodies = self.log_dir.join("bodies");
            if bodies.exists() {
                let _ = fs::remove_dir_all(&bodies);
                let _ = fs::create_dir_all(&bodies);
            }
            let search = self.log_dir.join("search");
            if search.exists() {
                let _ = fs::remove_dir_all(&search);
                let _ = fs::create_dir_all(&search);
            }
            self.today_cache.lock().unwrap().entries.clear();
            self.indexed_params.lock().unwrap().clear();
            save_indexed_params(&self.log_dir, &HashSet::new());
        }
        Ok(())
    }

    /// Purges log files (meta, idx, bodies, sqlite search) for dates older than `days` ago.
    /// A value of 0 means keep forever (no-op). Returns number of purged dates.
    pub fn purge_logs_older_than(&self, days: u32) -> Result<usize, String> {
        if days == 0 {
            return Ok(0);
        }

        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

        let mut purged_count = 0;
        let all_dates = self.list_dates();
        for d in all_dates {
            if d.as_str() < cutoff_str.as_str() {
                let lock = self.date_lock(&d);
                let _guard = lock.lock().unwrap();
                if clear_date_files(&self.log_dir, &d).is_ok() {
                    purged_count += 1;
                }
            }
        }
        Ok(purged_count)
    }

    pub fn indexed_param_keys(&self) -> Vec<String> {
        let mut keys: Vec<_> = self
            .indexed_params
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    pub fn is_param_indexed(&self, key: &str) -> bool {
        self.indexed_params.lock().unwrap().contains(key)
    }

    pub fn learn_param_key(&self, key: &str) {
        let key = key.trim();
        if key.is_empty() {
            return;
        }
        let mut set = self.indexed_params.lock().unwrap();
        if set.insert(key.to_string()) {
            save_indexed_params(&self.log_dir, &set);
        }
    }

    /// FTS / structured search within one date (sync). Returns hits newest-first.
    pub fn search_logs(
        &self,
        date: &str,
        query: &str,
        host_filter: Option<&str>,
        method_filter: Option<&str>,
        status_filter: Option<u16>,
        param_key: Option<&str>,
        param_value: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ApiLogSearchHit>, String> {
        self.flush_search_index();
        let limit = limit.clamp(1, 200);

        if let Some(key) = param_key {
            if self.is_param_indexed(key) {
                return search_param_index(
                    &self.log_dir,
                    date,
                    key,
                    param_value.unwrap_or(""),
                    host_filter,
                    method_filter,
                    status_filter,
                    limit,
                );
            }
            // Unlearned param: caller should scan; return empty here
            return Ok(Vec::new());
        }

        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        search_fts(
            &self.log_dir,
            date,
            query,
            host_filter,
            method_filter,
            status_filter,
            limit,
        )
    }

    /// Bounded body-file scan for an unlearned param key. Learns the key afterwards.
    pub fn scan_bodies_for_param(
        &self,
        date: &str,
        param_key: &str,
        param_value: &str,
        host_filter: Option<&str>,
        method_filter: Option<&str>,
        status_filter: Option<u16>,
        limit: usize,
        mut on_hit: impl FnMut(ApiLogSearchHit),
    ) -> Vec<ApiLogSearchHit> {
        let limit = limit.clamp(1, 200);
        let mut hits = Vec::new();
        let summaries = self.get_summaries(date, None, None, None, false);

        for summary in summaries {
            if hits.len() >= limit {
                break;
            }
            if let Some(host) = host_filter {
                if !host.is_empty() && !summary.host.contains(host) {
                    continue;
                }
            }
            if let Some(method) = method_filter {
                if !method.is_empty() && summary.method != method {
                    continue;
                }
            }
            if let Some(status) = status_filter {
                if summary.status_code != Some(status) {
                    continue;
                }
            }

            let Some(body) = load_body_file(&self.log_dir, date, &summary.id) else {
                continue;
            };

            let matched = json_param_matches(body.response_body.as_deref(), param_key, param_value)
                || json_param_matches(body.request_body.as_deref(), param_key, param_value);
            if !matched {
                continue;
            }

            let hit = ApiLogSearchHit {
                summary: summary.clone(),
                snippet: Some(format!("{param_key}={param_value}")),
                from_scan: true,
            };
            on_hit(hit.clone());
            hits.push(hit);

            // Opportunistic backfill for this id
            if let Some(entry) = self.get_log_by_id(&summary.id, Some(date)) {
                let keys = vec![param_key.to_string()];
                let _ = index_log_for_search(&self.log_dir, date, &entry, &keys);
            }
        }

        self.learn_param_key(param_key);
        hits
    }

    pub fn log_dir(&self) -> &Path {
        &self.log_dir
    }
}

fn today_date_string() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn date_from_timestamp(ts: &str) -> String {
    if ts.len() >= 10 {
        ts[0..10].to_string()
    } else {
        "unknown".to_string()
    }
}

fn truncate_opt(s: Option<String>, cap: usize) -> Option<String> {
    s.map(|s| truncate_bytes(&s, cap))
}

fn truncate_bytes(s: &str, cap: usize) -> String {
    if s.len() <= cap {
        return s.to_string();
    }
    let mut end = cap;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

fn matches_filters(
    entry: &ApiLogSummary,
    domain_filter: Option<&str>,
    method_filter: Option<&str>,
    host_filter: Option<&str>,
    exact_match: bool,
) -> bool {
    if exact_match {
        if let Some(filter) = domain_filter {
            if !filter.is_empty() && entry.path != filter {
                return false;
            }
        }
        if let Some(filter) = method_filter {
            if !filter.is_empty() && entry.method != filter {
                return false;
            }
        }
        if let Some(filter) = host_filter {
            if !filter.is_empty() && entry.host != filter {
                return false;
            }
        }
    } else {
        if let Some(filter) = domain_filter {
            if !filter.is_empty() && !entry.url.contains(filter) {
                return false;
            }
        }
        if let Some(filter) = method_filter {
            if !filter.is_empty() && entry.method != filter {
                return false;
            }
        }
        if let Some(filter) = host_filter {
            if !filter.is_empty() && !entry.host.contains(filter) {
                return false;
            }
        }
    }
    true
}

fn read_summaries_from_disk(log_dir: &Path, date: &str) -> Vec<ApiLogSummary> {
    let meta_path = log_dir.join(format!("{date}.meta.jsonl"));
    if meta_path.exists() {
        let mut logs = Vec::new();
        if let Ok(file) = fs::File::open(meta_path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if let Ok(s) = serde_json::from_str::<ApiLogSummary>(&line) {
                    logs.push(s);
                }
            }
        }
        logs.reverse();
        return logs;
    }

    // Legacy full jsonl
    let legacy = log_dir.join(format!("{date}.jsonl"));
    if !legacy.exists() {
        return Vec::new();
    }
    let mut logs = Vec::new();
    if let Ok(file) = fs::File::open(legacy) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if let Ok(entry) = serde_json::from_str::<ApiLogEntry>(&line) {
                logs.push(entry.summary());
            }
        }
    }
    logs.reverse();
    logs
}

fn load_meta_by_id(log_dir: &Path, date: &str, id: &str) -> Option<ApiLogEntry> {
    // Prefer idx + meta seek
    let idx_path = log_dir.join(format!("{date}.idx"));
    let meta_path = log_dir.join(format!("{date}.meta.jsonl"));
    if idx_path.exists() && meta_path.exists() {
        if let Ok(file) = fs::File::open(&idx_path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                let mut parts = line.splitn(2, '\t');
                let Some(line_id) = parts.next() else {
                    continue;
                };
                if line_id != id {
                    continue;
                }
                let Some(offset_str) = parts.next() else {
                    continue;
                };
                let Ok(offset) = offset_str.parse::<u64>() else {
                    continue;
                };
                if let Ok(mut meta_file) = fs::File::open(&meta_path) {
                    if meta_file.seek(SeekFrom::Start(offset)).is_ok() {
                        let mut reader = BufReader::new(meta_file);
                        let mut line = String::new();
                        if reader.read_line(&mut line).is_ok() {
                            if let Ok(summary) = serde_json::from_str::<ApiLogSummary>(line.trim())
                            {
                                return Some(summary.to_list_entry());
                            }
                        }
                    }
                }
            }
        }
        // Fallback: scan meta
        if let Ok(file) = fs::File::open(&meta_path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if let Ok(summary) = serde_json::from_str::<ApiLogSummary>(&line) {
                    if summary.id == id {
                        return Some(summary.to_list_entry());
                    }
                }
            }
        }
    }

    // Legacy
    let legacy = log_dir.join(format!("{date}.jsonl"));
    if legacy.exists() {
        if let Ok(file) = fs::File::open(legacy) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if let Ok(entry) = serde_json::from_str::<ApiLogEntry>(&line) {
                    if entry.id == id {
                        let mut e = entry;
                        e.has_bodies = e.summary().has_bodies;
                        return Some(e);
                    }
                }
            }
        }
    }
    None
}

fn load_body_file(log_dir: &Path, date: &str, id: &str) -> Option<ApiLogBodyFile> {
    let path = log_dir.join("bodies").join(date).join(format!("{id}.json"));
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn clear_date_files(log_dir: &Path, date: &str) -> Result<(), String> {
    for name in [
        format!("{date}.meta.jsonl"),
        format!("{date}.idx"),
        format!("{date}.jsonl"),
    ] {
        let path = log_dir.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    let bodies = log_dir.join("bodies").join(date);
    if bodies.exists() {
        fs::remove_dir_all(bodies).map_err(|e| e.to_string())?;
    }
    let search = log_dir.join("search").join(format!("{date}.sqlite"));
    if search.exists() {
        fs::remove_file(search).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn indexed_params_path(log_dir: &Path) -> PathBuf {
    log_dir.join("indexed_params.json")
}

fn load_indexed_params(log_dir: &Path) -> HashSet<String> {
    let path = indexed_params_path(log_dir);
    let Ok(data) = fs::read_to_string(path) else {
        return HashSet::new();
    };
    serde_json::from_str::<Vec<String>>(&data)
        .unwrap_or_default()
        .into_iter()
        .collect()
}

fn save_indexed_params(log_dir: &Path, set: &HashSet<String>) {
    let mut keys: Vec<_> = set.iter().cloned().collect();
    keys.sort();
    if let Ok(json) = serde_json::to_string_pretty(&keys) {
        let _ = fs::write(indexed_params_path(log_dir), json);
    }
}

fn search_db_path(log_dir: &Path, date: &str) -> PathBuf {
    log_dir.join("search").join(format!("{date}.sqlite"))
}

static INITIALIZED_DBS: std::sync::LazyLock<Mutex<std::collections::HashSet<PathBuf>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

fn open_search_db(log_dir: &Path, date: &str) -> Result<Connection, String> {
    let search_dir = log_dir.join("search");
    let _ = fs::create_dir_all(&search_dir);
    let path = search_db_path(log_dir, date);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    // Optimize SQLite performance & concurrency with WAL mode and busy timeout
    let _ = conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
    );

    let mut init_guard = INITIALIZED_DBS.lock().map_err(|e| e.to_string())?;
    if !init_guard.contains(&path) {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                host TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                status_code INTEGER,
                has_bodies INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_logs_host ON logs(host);
            CREATE INDEX IF NOT EXISTS idx_logs_method ON logs(method);
            CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
                id UNINDEXED,
                req_text,
                res_text,
                tokenize = 'unicode61'
            );
            CREATE TABLE IF NOT EXISTS param_values (
                id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_param_key_value ON param_values(key, value);
            ",
        )
        .map_err(|e| e.to_string())?;

        // Migrate older search DBs that lack url column
        let _ = conn.execute(
            "ALTER TABLE logs ADD COLUMN url TEXT NOT NULL DEFAULT ''",
            [],
        );

        init_guard.insert(path);
    }
    Ok(conn)
}

fn flush_index_batch(log_dir: &Path, batch: &mut Vec<SearchIndexTask>) {
    if batch.is_empty() {
        return;
    }
    let mut by_date: HashMap<String, (Vec<ApiLogEntry>, Vec<String>)> = HashMap::new();
    for task in batch.drain(..) {
        let entry = by_date
            .entry(task.date)
            .or_insert_with(|| (Vec::new(), task.indexed_params));
        entry.0.push(task.entry);
    }

    for (date, (entries, keys)) in by_date {
        let _ = index_logs_batch_for_search(log_dir, &date, &entries, &keys);
    }
}

fn index_log_for_search(
    log_dir: &Path,
    date: &str,
    entry: &ApiLogEntry,
    indexed_keys: &[String],
) -> Result<(), String> {
    index_logs_batch_for_search(log_dir, date, std::slice::from_ref(entry), indexed_keys)
}

fn index_logs_batch_for_search(
    log_dir: &Path,
    date: &str,
    entries: &[ApiLogEntry],
    indexed_keys: &[String],
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut conn = open_search_db(log_dir, date)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt_logs = tx
            .prepare_cached(
                "INSERT OR REPLACE INTO logs (id, timestamp, host, method, path, url, status_code, has_bodies)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|e| e.to_string())?;

        let mut stmt_del_fts = tx
            .prepare_cached("DELETE FROM logs_fts WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let mut stmt_ins_fts = tx
            .prepare_cached("INSERT INTO logs_fts (id, req_text, res_text) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;

        let mut stmt_params = tx
            .prepare_cached(
                "INSERT OR REPLACE INTO param_values (id, key, value) VALUES (?1, ?2, ?3)",
            )
            .map_err(|e| e.to_string())?;

        for entry in entries {
            let _ = stmt_logs.execute(params![
                entry.id,
                entry.timestamp,
                entry.host,
                entry.method,
                entry.path,
                entry.url,
                entry.status_code.map(i64::from),
                i64::from(entry.has_bodies || entry.summary().has_bodies),
            ]);

            let _ = stmt_del_fts.execute(params![entry.id]);
            let req_text = truncate_bytes(
                entry.request_body.as_deref().unwrap_or(""),
                FTS_TEXT_CAP_BYTES,
            );
            let res_text = truncate_bytes(
                entry.response_body.as_deref().unwrap_or(""),
                FTS_TEXT_CAP_BYTES,
            );
            if !req_text.is_empty() || !res_text.is_empty() {
                let _ = stmt_ins_fts.execute(params![entry.id, req_text, res_text]);
            }

            for key in indexed_keys {
                let values = extract_json_param_values(entry.response_body.as_deref(), key)
                    .into_iter()
                    .chain(extract_json_param_values(
                        entry.request_body.as_deref(),
                        key,
                    ));
                for value in values {
                    let _ = stmt_params.execute(params![entry.id, key, value]);
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn search_fts(
    log_dir: &Path,
    date: &str,
    query: &str,
    host_filter: Option<&str>,
    method_filter: Option<&str>,
    status_filter: Option<u16>,
    limit: usize,
) -> Result<Vec<ApiLogSearchHit>, String> {
    let path = search_db_path(log_dir, date);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = open_search_db(log_dir, date)?;

    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.timestamp, l.host, l.method, l.path, l.url, l.status_code, l.has_bodies,
                    snippet(logs_fts, 2, '[', ']', '…', 24)
             FROM logs_fts
             JOIN logs l ON l.id = logs_fts.id
             WHERE logs_fts MATCH ?1
             ORDER BY l.timestamp DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    let rows = stmt
        .query_map(
            params![sanitize_fts_query(query), (limit * 4) as i64],
            |row| {
                Ok((
                    ApiLogSummary {
                        id: row.get(0)?,
                        timestamp: row.get(1)?,
                        host: row.get(2)?,
                        method: row.get(3)?,
                        path: row.get(4)?,
                        url: row.get::<_, String>(5).unwrap_or_default(),
                        status_code: row.get::<_, Option<i64>>(6)?.map(|v| v as u16),
                        has_bodies: row.get::<_, i64>(7)? != 0,
                        is_mocked: false,
                    },
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        let (mut summary, snippet) = row;
        if summary.url.is_empty() {
            summary.url = format!("https://{}{}", summary.host, summary.path);
        }
        if let Some(host) = host_filter {
            if !host.is_empty() && !summary.host.contains(host) {
                continue;
            }
        }
        if let Some(method) = method_filter {
            if !method.is_empty() && summary.method != method {
                continue;
            }
        }
        if let Some(status) = status_filter {
            if summary.status_code != Some(status) {
                continue;
            }
        }
        hits.push(ApiLogSearchHit {
            summary,
            snippet,
            from_scan: false,
        });
        if hits.len() >= limit {
            break;
        }
    }
    Ok(hits)
}

fn search_param_index(
    log_dir: &Path,
    date: &str,
    key: &str,
    value: &str,
    host_filter: Option<&str>,
    method_filter: Option<&str>,
    status_filter: Option<u16>,
    limit: usize,
) -> Result<Vec<ApiLogSearchHit>, String> {
    let path = search_db_path(log_dir, date);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = open_search_db(log_dir, date)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.timestamp, l.host, l.method, l.path, l.url, l.status_code, l.has_bodies, p.value
             FROM param_values p
             JOIN logs l ON l.id = p.id
             WHERE p.key = ?1 AND p.value LIKE ?2
             ORDER BY l.timestamp DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let like = if value.is_empty() {
        "%".to_string()
    } else {
        format!("%{value}%")
    };

    let rows = stmt
        .query_map(params![key, like, limit as i64], |row| {
            Ok((
                ApiLogSummary {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    host: row.get(2)?,
                    method: row.get(3)?,
                    path: row.get(4)?,
                    url: row.get::<_, String>(5).unwrap_or_default(),
                    status_code: row.get::<_, Option<i64>>(6)?.map(|v| v as u16),
                    has_bodies: row.get::<_, i64>(7)? != 0,
                    is_mocked: false,
                },
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for row in rows.flatten() {
        let (mut summary, found_value) = row;
        if summary.url.is_empty() {
            summary.url = format!("https://{}{}", summary.host, summary.path);
        }
        if let Some(host) = host_filter {
            if !host.is_empty() && !summary.host.contains(host) {
                continue;
            }
        }
        if let Some(method) = method_filter {
            if !method.is_empty() && summary.method != method {
                continue;
            }
        }
        if let Some(status) = status_filter {
            if summary.status_code != Some(status) {
                continue;
            }
        }
        hits.push(ApiLogSearchHit {
            summary,
            snippet: Some(format!("{key}={found_value}")),
            from_scan: false,
        });
    }
    Ok(hits)
}

fn sanitize_fts_query(query: &str) -> String {
    // Quote as a phrase for substring-ish matching of tokens
    let cleaned: String = query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return "\"\"".to_string();
    }
    format!("\"{cleaned}\"")
}

fn extract_json_param_values(body: Option<&str>, key: &str) -> Vec<String> {
    let Some(body) = body else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_key_values(&value, key, &mut out);
    out
}

fn collect_key_values(value: &Value, key: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if k == key {
                    out.push(value_to_search_string(v));
                }
                collect_key_values(v, key, out);
            }
        }
        Value::Array(arr) => {
            for v in arr {
                collect_key_values(v, key, out);
            }
        }
        _ => {}
    }
}

fn value_to_search_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

fn json_param_matches(body: Option<&str>, key: &str, expected: &str) -> bool {
    extract_json_param_values(body, key)
        .into_iter()
        .any(|v| expected.is_empty() || v.contains(expected))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_entry(id: &str, ts: &str, method: &str, host: &str, path: &str) -> ApiLogEntry {
        ApiLogEntry {
            id: id.to_string(),
            timestamp: ts.to_string(),
            method: method.to_string(),
            url: format!("http://{host}{path}"),
            host: host.to_string(),
            path: path.to_string(),
            status_code: Some(200),
            request_headers: None,
            request_body: None,
            response_headers: None,
            response_body: None,
            has_bodies: false,
            is_mocked: false,
        }
    }

    #[test]
    fn test_save_and_get_logs() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());

        let entry = sample_entry("1", "2026-02-19T10:00:00Z", "GET", "example.com", "/");
        service.save_log(&entry);

        let dates = service.list_dates();
        assert_eq!(dates.len(), 1);
        assert_eq!(dates[0], "2026-02-19");

        let logs = service.get_logs("2026-02-19", None, None, None, false);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, "1");
        assert!(logs[0].request_body.is_none());
    }

    #[test]
    fn test_meta_body_split_and_detail() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());

        let mut entry = sample_entry("1", "2026-02-19T10:00:00Z", "POST", "example.com", "/api");
        entry.response_body = Some(r#"{"errorCode":"E001"}"#.to_string());
        entry.response_headers = Some(HashMap::from([(
            "content-type".into(),
            "application/json".into(),
        )]));
        service.save_log(&entry);

        let list = service.get_logs("2026-02-19", None, None, None, false);
        assert_eq!(list.len(), 1);
        assert!(list[0].response_body.is_none());
        assert!(list[0].has_bodies);

        let detail = service.get_log_by_id("1", Some("2026-02-19")).unwrap();
        assert_eq!(
            detail.response_body.as_deref(),
            Some(r#"{"errorCode":"E001"}"#)
        );
    }

    #[test]
    fn test_filter_logs() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());

        service.save_log(&sample_entry(
            "1",
            "2026-02-19T10:00:00Z",
            "GET",
            "example.com",
            "/api/v1",
        ));
        let mut e2 = sample_entry("2", "2026-02-19T10:01:00Z", "POST", "other.com", "/api/v2");
        e2.url = "http://other.com/api/v2".to_string();
        service.save_log(&e2);

        assert_eq!(
            service
                .get_logs("2026-02-19", None, None, None, false)
                .len(),
            2
        );
        assert_eq!(
            service
                .get_logs("2026-02-19", Some("v1".into()), None, None, false)
                .len(),
            1
        );
        assert_eq!(
            service
                .get_logs("2026-02-19", None, Some("GET".into()), None, false)
                .len(),
            1
        );
        assert_eq!(
            service
                .get_logs("2026-02-19", None, None, Some("other.com".into()), false)
                .len(),
            1
        );
    }

    #[test]
    fn test_clear_logs() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());
        service.save_log(&sample_entry(
            "1",
            "2026-02-19T10:00:00Z",
            "GET",
            "example.com",
            "/",
        ));
        assert_eq!(service.list_dates().len(), 1);
        service.clear_logs(Some("2026-02-19".into())).unwrap();
        assert_eq!(service.list_dates().len(), 0);
        service.save_log(&sample_entry(
            "1",
            "2026-02-19T10:00:00Z",
            "GET",
            "example.com",
            "/",
        ));
        service.clear_logs(None).unwrap();
        assert_eq!(service.list_dates().len(), 0);
    }

    #[test]
    fn test_exact_match_filter() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());
        service.save_log(&sample_entry(
            "1",
            "2026-02-19T10:00:00Z",
            "GET",
            "example.com",
            "/api/v1",
        ));

        assert_eq!(
            service
                .get_logs(
                    "2026-02-19",
                    Some("/api/v1".into()),
                    None,
                    Some("example.com".into()),
                    true,
                )
                .len(),
            1
        );
        assert_eq!(
            service
                .get_logs("2026-02-19", Some("/api".into()), None, None, true)
                .len(),
            0
        );
        assert_eq!(
            service
                .get_logs("2026-02-19", None, None, Some("example.co".into()), true)
                .len(),
            0
        );
    }

    #[test]
    fn test_legacy_jsonl_read() {
        let dir = tempdir().unwrap();
        let log_dir = dir.path().join("api_logs");
        fs::create_dir_all(&log_dir).unwrap();
        let entry = sample_entry("legacy", "2026-02-19T10:00:00Z", "GET", "example.com", "/");
        let line = serde_json::to_string(&entry).unwrap();
        fs::write(log_dir.join("2026-02-19.jsonl"), format!("{line}\n")).unwrap();

        let service = ApiLogService::new(dir.path().to_path_buf());
        let logs = service.get_logs("2026-02-19", None, None, None, false);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].id, "legacy");
    }

    #[test]
    fn test_fts_and_adaptive_param() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());

        let mut entry = sample_entry("1", "2026-02-19T10:00:00Z", "POST", "example.com", "/api");
        entry.response_body = Some(r#"{"errorCode":"E001","msg":"fail"}"#.to_string());
        service.save_log(&entry);

        let fts_hits = service
            .search_logs("2026-02-19", "E001", None, None, None, None, None, 10)
            .unwrap();
        assert!(!fts_hits.is_empty());

        assert!(!service.is_param_indexed("errorCode"));
        let scan_hits = service.scan_bodies_for_param(
            "2026-02-19",
            "errorCode",
            "E001",
            None,
            None,
            None,
            10,
            |_| {},
        );
        assert_eq!(scan_hits.len(), 1);
        assert!(service.is_param_indexed("errorCode"));

        let mut entry2 = sample_entry("2", "2026-02-19T11:00:00Z", "POST", "example.com", "/api");
        entry2.response_body = Some(r#"{"errorCode":"E002"}"#.to_string());
        service.save_log(&entry2);

        let indexed = service
            .search_logs(
                "2026-02-19",
                "",
                None,
                None,
                None,
                Some("errorCode"),
                Some("E002"),
                10,
            )
            .unwrap();
        assert_eq!(indexed.len(), 1);
        assert_eq!(indexed[0].summary.id, "2");
    }

    #[test]
    fn test_purge_logs_older_than() {
        let dir = tempdir().unwrap();
        let service = ApiLogService::new(dir.path().to_path_buf());

        // Create log entry for 2020-01-01 (older than 14 days)
        let old_entry = sample_entry("old", "2020-01-01T10:00:00Z", "GET", "example.com", "/old");
        service.save_log(&old_entry);

        // Create log entry for today
        let today = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let recent_entry = sample_entry("recent", &today, "GET", "example.com", "/recent");
        service.save_log(&recent_entry);

        assert_eq!(service.list_dates().len(), 2);

        // Purge with days = 14: old log (2020) should be purged, recent log kept
        let purged = service.purge_logs_older_than(14).unwrap();
        assert_eq!(purged, 1);
        assert_eq!(service.list_dates().len(), 1);
        assert_eq!(service.list_dates()[0], today_date_string());
    }
}
