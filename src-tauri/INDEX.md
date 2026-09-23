# `src-tauri/`

Cargo workspace. OS-specific capture and admin manifests stay in the crate that needs them (`#[cfg(target_os = "...")]`), not in the UI.

| Crate | Role |
| :--- | :--- |
| `hg-core` | Shared GUI ↔ serve types and protocol. No OS I/O. |
| `hg-gui` | Tauri app: windows, commands, deep links, overlay. Validate IPC inputs here. |
| `hg-serve` | Headless backend: proxy, mock, storage, CLI library, **chat P2P/crypto**. |
| `hgc` | Thin console binary (`asInvoker`). Calls `hg-serve` CLI. Never inherit serve’s admin manifest. |

Do not add `INDEX.md` under a crate `src/`. Protocol changes start in `hg-core`, then GUI and serve.

Companion / second GUI: `horizon-gateway-workspace` (`HG_SERVE_ATTACH_ONLY=1`, identifier `com.lurain.horizon-gateway-workspace`) starts at `/comm`. `open_workspace_app` (optional tab) and `open_hub_app` spawn or focus the other window. Release bundles it beside Hub via `externalBin` (`scripts/build-serve-sidecar.mjs`). Hub owns the updater; the workspace process does not check for updates. Build: `cargo build -p horizon-gateway --bins`.

Chat: `chat_*` IPC is served by `hg-serve` (`src/chat/`); incoming frames publish `chat-frame-received` on the event bus. Avatar catalog commands (`get_comm_avatar_catalog`, `compose_comm_avatar`, `write_comm_avatar_part`, `push_comm_avatar_draft`) are serve CLI. Overlay painting stays in the GUI and reloads when serve emits `avatar-catalog-changed`. `push_comm_avatar_draft` emits `avatar-draft` into the open editor without writing a file.

Session handoff: `session_handoff_put` / `session_handoff_take` (30s, one-shot). Event `session-handoff` carries `{ ready: true }` only. Hub puts on Team open; `/comm` or `?sessionHandoff=1` takes and calls `setSession`.
