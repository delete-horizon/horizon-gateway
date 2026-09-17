---
name: horizon-gateway
description: Inspect HTTP/API traffic, proxy status, domain monitoring, mock rules, UI/UX guides (annotations), and sandbox libraries captured by Horizon Gateway. Use when the user asks about network requests, API logs, proxy setup, domain health, HTTP debugging, local routing, pipelines, JSON schemas, crypto presets, inspector policies, or page UI/UX guidelines.
---

# Horizon Gateway Skill

Horizon Gateway is a local HTTP proxy/debugging app. Agents interact with it in two ways:

| Tool | Use when |
|------|----------|
| `scripts/logs.mjs` | Read API logs **directly from disk** (fast, no app startup) |
| `hgc` | Call **any Horizon Gateway command** (domains, proxy, mocking, sandbox, settings, …) |

**UI layout & theme conventions:** see [watchtower-ui](../watchtower-ui/SKILL.md) (section titles outside cards, typography, spacing, theme injection).

## Install this skill

Run once so your agent discovers Horizon Gateway automatically:

```bash
hgc init                  # global install (auto-detect agent)
hgc init --target cursor  # specific agent
hgc init --target all     # all supported agents
hgc init --project        # current repo: .agents/skills/horizon-gateway/
hgc init --print          # print SKILL.md without installing
```

Supported `--target` values: `auto`, `all`, `cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`.

Without this skill, bootstrap from the binary:

```bash
hgc list
hgc help <command>
```

`horizon-gateway cli …` still works as a compatibility wrapper for `hgc`.

---

## 1. API Logs (disk reader)

Best for searching and inspecting captured API traffic. Does **not** start the Horizon Gateway app.

```bash
node <skill-dir>/scripts/logs.mjs [options]
```

After `hgc init`, `<skill-dir>` is typically `~/.cursor/skills/horizon-gateway` or `.agents/skills/horizon-gateway`.

### Options

- `--date <YYYY-MM-DD>`: Log date. Defaults to today.
- `--host <host>`: Filter by host (case-insensitive substring).
- `--method <method>`: HTTP method (GET, POST, …).
- `--path <path>`: Path substring filter.
- `--status <status>`: Status code (`500`, `4xx`, …).
- `--search <text>`: Search in request/response body.
- `--limit <number>`: Max results. Default `5`, max `50`.
- `--fields <fields>`: Comma-separated fields. Default `id,timestamp,method,host,path,status_code`.
  - Available: `id`, `timestamp`, `method`, `host`, `path`, `url`, `status_code`, `request_headers`, `response_headers`, `request_body`, `response_body`, `elapsed_ms`.
- `--truncate <length>`: Truncate body text. Default `200`.
- `--id <uuid>`: Fetch a single log by ID.
- `--summary`: Return aggregate stats instead of entries.

### Token-saving workflow

1. **Search first** with default fields — never pull bodies in list queries.
2. **Drill down** by `--id` with `--fields response_body --truncate 500`.

```bash
node .agents/skills/horizon-gateway/scripts/logs.mjs --host modetour.dev --status 500 --limit 5
node .agents/skills/horizon-gateway/scripts/logs.mjs --id <uuid> --fields response_body --truncate 1000
```

---

## 2. Horizon Gateway CLI (full app commands)

```bash
hgc <subcommand> [args]
hgc <command> [payload]          # implied run
```

`hgc` is an asInvoker console binary (no UAC). On Windows it is installed next to the app as `hgc.exe`.

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `init` | Install this skill for coding agents |
| `list` | List all available commands (`category`, `guiOnly`, `payloadExample`) |
| `help <command>` | Show payload schema for one command |
| `[run] <command> [payload] [--query <path>]` | Execute a command (headless — no GUI required). `run` is optional. |

`hgc` works **without** starting the Horizon Gateway GUI. If the backend is already running it talks over IPC; otherwise it bootstraps app services, prints JSON to stdout, and exits.

Payload forms:

```bash
hgc get_domains '{}'
hgc regist_domains @domains.json
hgc create_scenario -   # JSON from stdin
hgc get_domains '{}' --payload @body.json
```

### Windows PowerShell

**JSON escaping** — wrap the payload in single quotes and escape inner double quotes:

```powershell
hgc set_local_route_enabled '{\"id\": 24, \"enabled\": true}'
```

**Prefer file payloads** for complex JSON (avoids escaping issues):

```powershell
hgc regist_domains @domains.json
hgc create_scenario - --payload @body.json   # stdin
```

If a terminal still drops output, `| Out-String` remains a safe fallback:

```powershell
hgc get_proxy_status '{}' | Out-String
```

### Examples

```bash
hgc list
hgc help get_api_logs
hgc get_domains '{}'
hgc get_domains '{}' --query data.[].url
hgc get_api_logs '{"date":"2026-07-06"}' --query data.logs[statusCode>=500].path
hgc get_saved_pipelines '{}' --query data.[].{id,name}
```

### Recommended commands by task

| Task | Start with |
|------|------------|
| Domains / groups | `get_domains`, `get_groups`, `regist_domains` |
| Proxy / routing | `get_proxy_status`, `get_local_routes`, `start_local_proxy` |
| API logs | Prefer `logs.mjs`; or `get_api_logs`, `list_api_log_dates` |
| Mocking | `get_scenarios`, `get_mock_rules`, `create_mock_rule` |
| Pipeline library | `get_saved_pipelines`, `create_saved_pipeline`, `execute_pipeline` |
| JSON Schema registry | `get_json_schemas`, `create_json_schema`, `validate_json_schema` |
| Crypto presets | `get_crypto_presets`, `create_crypto_preset`, `process_crypto` |
| Inspector / UI/UX guides | `get_annotations`, `add_annotation`, `update_annotation`, `delete_annotation`, `import_annotations` |

Skip entries where `guiOnly: true` in `hgc list` (window/dialog commands).

### UI/UX Guides (Annotations)

Use when reading or maintaining selector-level UI/UX guidelines before editing page UI. Guides are stored locally by Horizon Gateway and can be matched by `domain` / `url` / `hostPattern` / `pathPattern` in the app.

Each guide may include **`locators`** (priority list: `testid` → `role` → `label` → `text` → `css`) and **`lastValidation`** (`ok` | `weak` | `broken` | `ambiguous`). Prefer testid/role/text over brittle CSS paths. Do **not** invent long `nth-of-type` CSS. Promote a fallback to primary only when status is `weak` and exactly one fallback matches (never auto-rewrite `broken`/`ambiguous`).

`--query` filters are **exact string equality** (not glob matching).

Always run `hgc help <command>` first if unsure — use `payloadExample` as the template. Prefer `@file.json` payloads on Windows PowerShell.

#### 1. Read / Search Guides

```bash
# Get single guide by ID
hgc get_annotation '{"id":"g-101"}'

# Compact fields including locators + validation
hgc get_annotations '{}' --query "data.[].{id,selector,role,description,domain,locators,lastValidation}"

# Broken / weak guides for repair
hgc get_annotations '{}' --query "data[lastValidation.status==broken].{id,role,locators}"
hgc get_annotations '{}' --query "data[lastValidation.status==weak].{id,role,locators}"

# Filter by exact domain
hgc get_annotations '{}' --query "data[domain==modetour.dev].{id,selector,role,description,pathPattern}"
```

#### 2. Add / Upsert Guide

`add_annotation` accepts minimal payloads — `id`, `selector`, `domain`, `hostPattern`, `pathPattern`, `timestamp`, `tagName`, `content`, `thumbnail` are all **optional**!
- If `id` is omitted, a unique ID (`g-xxx`) is generated automatically.
- If `url` is provided, `domain`, `hostPattern`, and `pathPattern` are derived automatically.
- `selector` is synced automatically from `locators` (e.g. `[data-testid="submit"]`).

```bash
hgc add_annotation '{"role":"Submit Button","description":"Prevent duplicate clicks with 3s lock","url":"https://modetour.dev/checkout","locators":[{"strategy":"testid","value":"submit"}]}'
```

#### 3. Update Guide

`update_annotation` requires `id`. `role` and `description` are optional (omitted fields remain unchanged).

```bash
# Update description only
hgc update_annotation '{"id":"g-101","description":"Lock 5s and show success toast"}'

# Update role & url (pathPattern auto-filled to /checkout)
hgc update_annotation '{"id":"g-101","role":"Submit Button","url":"https://modetour.dev/checkout"}'
```

Running GUI watches `inspector_annotations.json` and emits `annotations-updated` within ~1s after CLI writes, so the Policies UI refreshes without restart.

To promote a weak fallback to primary, reorder `locators` so the working strategy is index 0 and pass them in `locators` (or use the in-page badge CTA).

#### 4. Delete Guide

```bash
hgc delete_annotation '{"id":"g-101"}'
```

#### 5. Bulk Import

```bash
hgc import_annotations @annotations.json
```

`annotations.json` shape: `{"annotations":[ /* Annotation objects */ ]}`.

#### 6. Injection Domains

Manage domain list for script injection:

```bash
# Add domain to injection list
hgc add_injection_domain '{"domain":"modetour.dev"}'

# Remove domain from injection list
hgc remove_injection_domain '{"domain":"modetour.dev"}'

# Get full injection domain list
hgc get_injection_domains '{}'
```

### Query syntax (`--query`)

| Pattern | Meaning |
|---------|---------|
| `data.logs` | Navigate object keys |
| `data.logs.[].path` | Project array field |
| `data.logs.[].{path,statusCode}` | Slice object fields |
| `data.logs[statusCode>=500].path` | Filter then project |

### When to use CLI vs logs.mjs

| Task | Prefer |
|------|--------|
| Search/filter API logs | `logs.mjs` |
| Get domains, proxy status, mocking rules, sandbox libraries, UI/UX guides | `hgc` |
| Mutate settings / guides | `hgc` |

### CLI limits

- **`hgc init` / `list` / `help` / `<command>`**: Run without the GUI (preferred for agents). No UAC.
- **`guiOnly` commands** (`open_window`, `save_root_ca`, …): Fail in headless `hgc` with a clear error — use the desktop app.
- **`start_local_proxy`**: Headless not supported yet (needs GUI `AppHandle` for proxy runtime).
- **Reading API logs**: Prefer `logs.mjs` (streaming, token-efficient).
- **GUI open + CLI write**: Annotation file changes are picked up by the running GUI (~1s). Still avoid racing GUI and CLI saves on the same annotation at the exact same moment.
- **`execute_pipeline`**: Rust runner only; FE-only `script` nodes are not supported via CLI.
- Always call `hgc help <command>` first if unsure — use the returned `payloadExample` as the template.

---

## Avatar parts

Pixel overlay SKUs are ASCII JSON in `avatar-parts/`. Agents should follow [avatar-parts](../avatar-parts/SKILL.md) and `avatar-parts/README.md`. Do not add parts in Rust.


---

## Response format

JSON to stdout. Errors on stderr: `{"success": false, "error": "..."}`.

Use `--query` to extract only the fields you need.
