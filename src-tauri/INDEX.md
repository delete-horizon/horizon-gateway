# `src-tauri/`

Cargo workspace. OS-specific capture and admin manifests stay in the crate that needs them (`#[cfg(target_os = "...")]`), not in the UI.

| Crate | Role |
| :--- | :--- |
| `hg-core` | Shared GUI ↔ serve types and protocol. No OS I/O. |
| `hg-gui` | Tauri app: windows, commands, deep links. Validate IPC inputs here. |
| `hg-serve` | Headless backend: proxy, mock, storage, CLI library. |
| `hgc` | Thin console binary (`asInvoker`). Calls `hg-serve` CLI. Never inherit serve’s admin manifest. |

Do not add `INDEX.md` under a crate `src/`. Protocol changes start in `hg-core`, then GUI and serve.
