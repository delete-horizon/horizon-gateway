# Horizon Gateway

Desktop MITM proxy, mock, and domain inspector (Tauri v2 + React). This file is the **project router**. `src/` trees are in `INDEX.md` files, not here.

## Where to work

| Path | What | Next |
| :--- | :--- | :--- |
| `src/` | Desktop UI | `src/INDEX.md` |
| `src-tauri/` | Rust crates | `src-tauri/INDEX.md` |
| `.agents/skills/` | Agent CLI / UI conventions | `horizon-gateway`, `watchtower-ui` — do not rewrite |
| `website/` | Marketing Astro site | `pnpm web:dev` / `pnpm web:build` |

Git root is this directory. Do not import `workspaces/{mesh,foundry,heroes}`.

## Finish

From this repo:

- `pnpm check` — Biome FSD imports + slice folder shape (`check:layout`)
- `pnpm typecheck`
- `pnpm clippy`

UI changes: follow `watchtower-ui` (section title outside the card). Network/proxy/mock/logs: `horizon-gateway` skill (`hgc`, `scripts/logs.mjs`).
