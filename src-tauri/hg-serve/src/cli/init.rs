use super::mcp::merge_mcp_servers;
use super::{cli_eprintln, cli_println};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const SKILL_MD: &str = include_str!("../../resources/skills/horizon-gateway/SKILL.md");
const LOGS_MJS: &str = include_str!("../../resources/skills/horizon-gateway/scripts/logs.mjs");

const SKILL_DIR_NAME: &str = "horizon-gateway";
const PROJECT_SKILL_REL: &str = ".agents/skills/horizon-gateway";

/// Project skill directories for agents that do not read `.agents/skills/`.
/// Cursor, Codex, Gemini CLI, and Copilot read the canonical copy.
const PROJECT_SKILL_LINKS: &[(&str, &str)] = &[
    ("claude", ".claude/skills/horizon-gateway"),
    ("windsurf", ".windsurf/skills/horizon-gateway"),
];

const PROJECT_MCP_FILES: &[(&str, &str)] = &[
    ("cursor-mcp", ".cursor/mcp.json"),
    ("claude-mcp", ".mcp.json"),
    ("gemini-mcp", ".gemini/settings.json"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentTarget {
    Cursor,
    Claude,
    Codex,
    Gemini,
    Copilot,
    Windsurf,
}

impl AgentTarget {
    fn id(self) -> &'static str {
        match self {
            Self::Cursor => "cursor",
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Copilot => "copilot",
            Self::Windsurf => "windsurf",
        }
    }

    fn all() -> &'static [Self] {
        &[
            Self::Cursor,
            Self::Claude,
            Self::Codex,
            Self::Gemini,
            Self::Copilot,
            Self::Windsurf,
        ]
    }

    fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "cursor" => Some(Self::Cursor),
            "claude" | "claude-code" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" | "antigravity" | "gemini-cli" => Some(Self::Gemini),
            "copilot" | "github-copilot" => Some(Self::Copilot),
            "windsurf" => Some(Self::Windsurf),
            _ => None,
        }
    }
}

#[derive(Debug, Default)]
pub struct InitOptions {
    pub target: Option<String>,
    pub project: bool,
    pub print: bool,
    pub force: bool,
    pub check: bool,
}

#[derive(Debug, Serialize)]
struct InstalledPath {
    target: String,
    path: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct InitResult {
    success: bool,
    scope: String,
    targets: Vec<String>,
    installed: Vec<InstalledPath>,
    skipped: Vec<InstalledPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    skill_md: Option<String>,
}

pub fn execute_init(args: &[String]) {
    let options = parse_init_options(args);

    if options.print {
        let output = InitResult {
            success: true,
            scope: "print".to_string(),
            targets: vec![],
            installed: vec![],
            skipped: vec![],
            skill_md: Some(SKILL_MD.to_string()),
        };
        cli_println(&serde_json::to_string_pretty(&output).unwrap());
        return;
    }

    let home = match home_dir() {
        Some(h) => h,
        None => {
            print_init_error("홈 디렉터리를 찾을 수 없습니다.");
            return;
        }
    };

    let targets = resolve_targets(options.target.as_deref(), &home);
    let target_ids: Vec<String> = targets.iter().map(|t| t.id().to_string()).collect();
    let mut installed = Vec::new();
    let mut skipped = Vec::new();

    if options.project {
        let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let (mut project_installed, mut project_skipped) =
            install_project_at(&root, options.force, options.check);
        installed.append(&mut project_installed);
        skipped.append(&mut project_skipped);
    }

    if !options.project {
        for target in &targets {
            let dir = global_skill_dir(&home, *target);
            match write_skill_bundle(&dir, options.force, options.check) {
                Ok(status) => installed.push(InstalledPath {
                    target: target.id().to_string(),
                    path: dir.to_string_lossy().into_owned(),
                    status,
                }),
                Err(e) => skipped.push(InstalledPath {
                    target: target.id().to_string(),
                    path: dir.to_string_lossy().into_owned(),
                    status: e,
                }),
            }
        }
    }

    let scope = if options.project {
        "project".to_string()
    } else {
        "global".to_string()
    };

    let output = InitResult {
        success: skipped.is_empty() || !installed.is_empty(),
        scope,
        targets: if options.project {
            vec!["project".to_string()]
        } else {
            target_ids
        },
        installed,
        skipped,
        skill_md: None,
    };

    cli_println(&serde_json::to_string_pretty(&output).unwrap());
}

fn parse_init_options(args: &[String]) -> InitOptions {
    let mut options = InitOptions::default();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--target" if i + 1 < args.len() => {
                options.target = Some(args[i + 1].clone());
                i += 2;
            }
            "--project" => {
                options.project = true;
                i += 1;
            }
            "--print" => {
                options.print = true;
                i += 1;
            }
            "--force" => {
                options.force = true;
                i += 1;
            }
            "--check" => {
                options.check = true;
                i += 1;
            }
            _ => i += 1,
        }
    }
    options
}

fn resolve_targets(target: Option<&str>, home: &Path) -> Vec<AgentTarget> {
    let selection = target.unwrap_or("auto");
    if selection.eq_ignore_ascii_case("all") {
        return AgentTarget::all().to_vec();
    }

    if selection.eq_ignore_ascii_case("auto") {
        let detected = detect_installed_targets(home);
        if detected.is_empty() {
            return AgentTarget::all().to_vec();
        }
        return detected;
    }

    if let Some(parsed) = AgentTarget::parse(selection) {
        return vec![parsed];
    }

    AgentTarget::all().to_vec()
}

fn detect_installed_targets(home: &Path) -> Vec<AgentTarget> {
    let mut targets = Vec::new();
    if home.join(".cursor").exists() {
        targets.push(AgentTarget::Cursor);
    }
    if env_path("CLAUDE_CONFIG_DIR")
        .map(|p| p.exists())
        .unwrap_or(false)
        || home.join(".claude").exists()
    {
        targets.push(AgentTarget::Claude);
    }
    if env_path("CODEX_HOME").map(|p| p.exists()).unwrap_or(false) || home.join(".codex").exists() {
        targets.push(AgentTarget::Codex);
    }
    if home.join(".gemini").exists() {
        targets.push(AgentTarget::Gemini);
    }
    if home.join(".copilot").exists() {
        targets.push(AgentTarget::Copilot);
    }
    if home.join(".codeium").join("windsurf").exists() {
        targets.push(AgentTarget::Windsurf);
    }
    targets
}

fn global_skill_dir(home: &Path, target: AgentTarget) -> PathBuf {
    match target {
        AgentTarget::Cursor => home.join(".cursor/skills").join(SKILL_DIR_NAME),
        AgentTarget::Claude => {
            let claude_home = env_path("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude"));
            claude_home.join("skills").join(SKILL_DIR_NAME)
        }
        AgentTarget::Codex => {
            let codex_home = env_path("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
            codex_home.join("skills").join(SKILL_DIR_NAME)
        }
        AgentTarget::Gemini => home.join(".gemini/config/skills").join(SKILL_DIR_NAME),
        AgentTarget::Copilot => home.join(".copilot/skills").join(SKILL_DIR_NAME),
        AgentTarget::Windsurf => home.join(".codeium/windsurf/skills").join(SKILL_DIR_NAME),
    }
}

fn write_skill_bundle(dest: &Path, force: bool, check: bool) -> Result<String, String> {
    let skill_file = dest.join("SKILL.md");
    let scripts_dir = dest.join("scripts");
    let logs_file = scripts_dir.join("logs.mjs");

    let existed = skill_file.exists();

    if existed {
        let current_skill = fs::read_to_string(&skill_file).unwrap_or_default();
        let current_logs = fs::read_to_string(&logs_file).unwrap_or_default();

        let is_up_to_date = current_skill == SKILL_MD && current_logs == LOGS_MJS;

        if is_up_to_date && !force {
            return Ok("up_to_date".to_string());
        }

        if check {
            return Ok(if is_up_to_date {
                "up_to_date".to_string()
            } else {
                "outdated".to_string()
            });
        }
    } else if check {
        return Ok("missing".to_string());
    }

    fs::create_dir_all(&scripts_dir).map_err(|e| format!("mkdir failed: {e}"))?;
    fs::write(&skill_file, SKILL_MD).map_err(|e| format!("write SKILL.md failed: {e}"))?;
    fs::write(&logs_file, LOGS_MJS).map_err(|e| format!("write logs.mjs failed: {e}"))?;

    Ok(if existed {
        "updated".to_string()
    } else {
        "installed".to_string()
    })
}

pub(crate) fn install_project_at(
    root: &Path,
    force: bool,
    check: bool,
) -> (Vec<InstalledPath>, Vec<InstalledPath>) {
    let mut installed = Vec::new();
    let mut skipped = Vec::new();
    let project_dir = root.join(PROJECT_SKILL_REL);
    match write_skill_bundle(&project_dir, force, check) {
        Ok(status) => installed.push(InstalledPath {
            target: "project".to_string(),
            path: project_dir.to_string_lossy().into_owned(),
            status,
        }),
        Err(err) => skipped.push(InstalledPath {
            target: "project".to_string(),
            path: project_dir.to_string_lossy().into_owned(),
            status: err,
        }),
    }
    for (target, rel) in PROJECT_SKILL_LINKS {
        let dest = root.join(rel);
        match link_project_skill(&dest, rel, force, check) {
            Ok(status) => installed.push(InstalledPath {
                target: (*target).to_string(),
                path: dest.to_string_lossy().into_owned(),
                status,
            }),
            Err(err) => skipped.push(InstalledPath {
                target: (*target).to_string(),
                path: dest.to_string_lossy().into_owned(),
                status: err,
            }),
        }
    }
    for (target, rel) in PROJECT_MCP_FILES {
        let path = root.join(rel);
        match write_project_mcp(&path, check) {
            Ok(status) => installed.push(InstalledPath {
                target: (*target).to_string(),
                path: path.to_string_lossy().into_owned(),
                status,
            }),
            Err(err) => skipped.push(InstalledPath {
                target: (*target).to_string(),
                path: path.to_string_lossy().into_owned(),
                status: err,
            }),
        }
    }
    (installed, skipped)
}

fn link_project_skill(dest: &Path, rel: &str, force: bool, check: bool) -> Result<String, String> {
    let relative = relative_skill_link(rel);
    if check {
        return Ok(if dest.exists() {
            "present".to_string()
        } else {
            "missing".to_string()
        });
    }
    if dest.symlink_metadata().is_ok() {
        if dest.is_symlink() {
            if dest.read_link().ok().as_deref() == Some(Path::new(&relative)) && !force {
                return Ok("up_to_date".to_string());
            }
            fs::remove_file(dest).map_err(|err| format!("remove link failed: {err}"))?;
        } else if dest.is_dir() && !force {
            return write_skill_bundle(dest, false, false);
        } else {
            remove_any(dest)?;
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("mkdir failed: {err}"))?;
    }
    match symlink_dir(Path::new(&relative), dest) {
        Ok(()) => Ok("linked".to_string()),
        Err(_) => write_skill_bundle(dest, force, false),
    }
}

fn relative_skill_link(rel: &str) -> String {
    let depth = Path::new(rel)
        .parent()
        .map(|parent| parent.components().count())
        .unwrap_or(0);
    let mut parts = Vec::with_capacity(depth + 3);
    for _ in 0..depth {
        parts.push("..");
    }
    parts.extend([".agents", "skills", "horizon-gateway"]);
    parts.join("/")
}

fn write_project_mcp(path: &Path, check: bool) -> Result<String, String> {
    let mut root = if path.exists() {
        let text =
            fs::read_to_string(path).map_err(|err| format!("read mcp config failed: {err}"))?;
        serde_json::from_str::<Value>(&text)
            .map_err(|err| format!("mcp config is not JSON: {err}"))?
    } else {
        serde_json::json!({})
    };
    if root
        .get("mcpServers")
        .and_then(|servers| servers.get("horizon-gateway"))
        .is_some()
    {
        return Ok("present".to_string());
    }
    if check {
        return Ok("missing".to_string());
    }
    let status = merge_mcp_servers(&mut root)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| format!("mkdir failed: {err}"))?;
        }
    }
    let text =
        serde_json::to_string_pretty(&root).map_err(|err| format!("encode mcp config: {err}"))?;
    fs::write(path, format!("{text}\n"))
        .map_err(|err| format!("write mcp config failed: {err}"))?;
    Ok(status.to_string())
}

fn remove_any(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|err| format!("stat failed: {err}"))?;
    if meta.is_symlink() || meta.is_file() {
        fs::remove_file(path).map_err(|err| format!("remove failed: {err}"))
    } else {
        fs::remove_dir_all(path).map_err(|err| format!("remove failed: {err}"))
    }
}

fn symlink_dir(target: &Path, dest: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, dest)
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, dest)
    }
}

pub fn is_any_skill_outdated() -> bool {
    let home = match home_dir() {
        Some(h) => h,
        None => return false,
    };

    let project_dir = std::env::current_dir()
        .map(|cwd| cwd.join(PROJECT_SKILL_REL))
        .unwrap_or_else(|_| PathBuf::from(PROJECT_SKILL_REL));
    if check_dir_outdated(&project_dir) {
        return true;
    }

    let targets = detect_installed_targets(&home);
    for target in targets {
        let dir = global_skill_dir(&home, target);
        if check_dir_outdated(&dir) {
            return true;
        }
    }

    false
}

fn check_dir_outdated(dir: &Path) -> bool {
    let skill_file = dir.join("SKILL.md");
    let meta = match fs::metadata(&skill_file) {
        Ok(m) => m,
        Err(_) => return false,
    };

    // Fast-path size check: if file size differs, it's outdated without reading content
    if meta.len() != SKILL_MD.len() as u64 {
        return true;
    }

    let logs_file = dir.join("scripts/logs.mjs");
    if let Ok(logs_meta) = fs::metadata(&logs_file) {
        if logs_meta.len() != LOGS_MJS.len() as u64 {
            return true;
        }
    } else {
        return true;
    }

    let current_skill = fs::read_to_string(&skill_file).unwrap_or_default();
    let current_logs = fs::read_to_string(&logs_file).unwrap_or_default();

    current_skill != SKILL_MD || current_logs != LOGS_MJS
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return Some(PathBuf::from(profile));
        }
    }
    std::env::var_os("HOME").map(PathBuf::from)
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
}

fn print_init_error(msg: &str) {
    let output = serde_json::json!({
        "success": false,
        "error": msg
    });
    cli_eprintln(&serde_json::to_string_pretty(&output).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_agent_targets() {
        assert_eq!(AgentTarget::parse("cursor"), Some(AgentTarget::Cursor));
        assert_eq!(AgentTarget::parse("claude-code"), Some(AgentTarget::Claude));
        assert_eq!(
            AgentTarget::parse("github-copilot"),
            Some(AgentTarget::Copilot)
        );
        assert_eq!(AgentTarget::parse("unknown"), None);
    }

    #[test]
    fn global_paths_use_expected_suffix() {
        let home = PathBuf::from("/home/user");
        assert!(global_skill_dir(&home, AgentTarget::Cursor)
            .ends_with(".cursor/skills/horizon-gateway"));
        assert!(global_skill_dir(&home, AgentTarget::Gemini)
            .ends_with(".gemini/config/skills/horizon-gateway"));
    }

    #[test]
    fn embedded_skill_has_frontmatter() {
        assert!(SKILL_MD.contains("name: horizon-gateway"));
        assert!(LOGS_MJS.contains("getHorizonGatewayLogsDir"));
    }

    #[test]
    fn project_init_links_claude_and_writes_read_only_mcp() {
        let dir = tempfile::tempdir().expect("temp");
        let root = dir.path();
        fs::create_dir_all(root.join(".gemini")).expect("gemini dir");
        fs::write(
            root.join(".gemini/settings.json"),
            "{\n  \"theme\": \"dark\",\n  \"mcpServers\": { \"other\": { \"command\": \"other\" } }\n}\n",
        )
        .expect("settings");
        fs::create_dir_all(root.join(".cursor")).expect("cursor");
        fs::write(
            root.join(".cursor/mcp.json"),
            "{\n  \"mcpServers\": {\n    \"horizon-gateway\": {\n      \"command\": \"hgc\",\n      \"args\": [\"mcp\", \"--allow-write\"]\n    }\n  }\n}\n",
        )
        .expect("cursor mcp");

        let (installed, skipped) = install_project_at(root, false, false);
        assert!(skipped.is_empty(), "{skipped:?}");
        assert!(root
            .join(".agents/skills/horizon-gateway/SKILL.md")
            .is_file());
        assert!(root
            .join(".agents/skills/horizon-gateway/scripts/logs.mjs")
            .is_file());
        let claude = root.join(".claude/skills/horizon-gateway");
        assert!(claude.is_symlink() || claude.join("SKILL.md").is_file());
        if claude.is_symlink() {
            assert_eq!(
                claude.read_link().expect("link").to_string_lossy(),
                "../../.agents/skills/horizon-gateway"
            );
        }
        assert!(root.join(".windsurf/skills/horizon-gateway").exists());

        let claude_mcp: Value =
            serde_json::from_str(&fs::read_to_string(root.join(".mcp.json")).expect("mcp"))
                .expect("json");
        assert_eq!(
            claude_mcp["mcpServers"]["horizon-gateway"]["args"],
            serde_json::json!(["mcp"])
        );
        let gemini: Value = serde_json::from_str(
            &fs::read_to_string(root.join(".gemini/settings.json")).expect("gemini"),
        )
        .expect("json");
        assert_eq!(gemini["theme"], "dark");
        assert_eq!(gemini["mcpServers"]["other"]["command"], "other");
        assert_eq!(
            gemini["mcpServers"]["horizon-gateway"]["args"],
            serde_json::json!(["mcp"])
        );
        let cursor: Value = serde_json::from_str(
            &fs::read_to_string(root.join(".cursor/mcp.json")).expect("cursor"),
        )
        .expect("json");
        assert_eq!(
            cursor["mcpServers"]["horizon-gateway"]["args"][1],
            "--allow-write"
        );

        let (again, skipped_again) = install_project_at(root, false, false);
        assert!(skipped_again.is_empty(), "{skipped_again:?}");
        assert!(
            again
                .iter()
                .any(|item| item.target == "claude" && item.status == "up_to_date")
                || again.iter().any(|item| item.target == "claude")
        );
        let _ = installed;
    }
}
