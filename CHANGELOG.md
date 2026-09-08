# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v2.8.6] - 2026-09-08

### Fixed

- **Windows auto-update install**: Prefer NSIS (`setup.exe`) for `windows-x86_64` updater artifacts; use passive install mode and skip `relaunch()` on Windows so the installer is not raced/aborted. Skip PATH prompt during silent/update installs.
- **Comm overlay coverage**: Use the full primary-monitor size (up to 4K) so flies/actions are not stuck in a 1920×1080 top-left cap.

### Added

- **Fly swatter**: Cursor-following swatter while flies are active, with a larger catch radius; flies expire after 20s.

## [v2.8.5] - 2026-09-08

### Added

- **Coffee & fly comm actions**: “Buy me coffee” / “Coffee on me” overlays, plus buzzing flies you can click-catch on the desktop (up to 100; empty overlay stays click-through).
- **Chaotic overlay variety**: Stronger randomization (position/scale/mood) and cheekier cat expressions (angry/derp marks).

## [v2.8.4] - 2026-09-07

### Added

- **Team chat (P2P MVP)**: KakaoTalk-style inbox/room windows for DM and group chat. Message bodies stay on-device; Supabase is used only for signaling (`device_keys`, `peer_sessions`, `chat_rooms` meta).
- **E2E crypto**: Per-device X25519 keys, DM session keys via ECDH+HKDF (userIds as salt only), AES-GCM seal/open, group room-key wrap.
- **LAN → tunnel connect**: Peer TCP listener advertises LAN hosts first; failed sends retry via tunnel endpoint / outbox.
- **Comm action overlay**: Shared tiny-skia animation engine with Windows click-through layered HWND presenter (macOS/Linux degrade stubs). Action chips in chat rooms play short stacked overlays without stealing input focus.

### Fixed

- **Comm overlay crash**: Windows presenter no longer touches HWND from the Tauri command thread; raster/DIB buffers are reused with a resolution cap so action playback cannot OOM-abort the app.
- **Missing workspace owner in members list**: Backfill migration + `listMembers` synthesizes `workspaces.owner_id` when the owner row is absent from `workspace_members`.
- **Chat input focus**: Sending with Enter no longer disables the message field (focus stays for rapid typing).
- **Chat notifications**: OS notifications for incoming text only; actions stay overlay-only (stacked sprites, no chat bubbles/unread spam).
- **Cuter comm overlays**: Procedural cats, hearts, soft glows, light rays, and star bursts replace the flat circle chips.

## [v2.8.3] - 2026-09-04

### Added

- **OS native screen capture & GitHub bug report**: In-app bug report modal with instant pixel-perfect window snapshot (`capture_app_screenshot`), Windows Snipping Tool integration (`trigger_os_snip`), clipboard paste (`Ctrl+V`), and one-click GitHub Issue generation with pre-populated system metadata (`Ctrl+Shift+B`).

### Fixed

- **Local reverse proxy timeout & streaming reliability**: Applied generous 600s timeout for local upstream routes (`local_origin`) to prevent premature 502 Bad Gateway timeouts during heavy Next.js RSC compiling and async data fetching.
- **POST forwarding & HTTP request smuggling fix**: Buffered request body forwarding and excluded duplicate `Transfer-Encoding` / `Content-Length` headers to prevent Node.js / Next.js `llhttp` parser aborts (`HPE_INVALID_CONTENT_LENGTH`).
- **Redirect Location header rewriting**: Automatically rewritten local `302/303` redirects (`http://localhost:3000/...` or `http://127.0.0.1:3000/...`) into public virtual host URLs (`https://www.modetour.dev/...`) to prevent browser host escapes.
- **Localhost IPv6 delay prevention**: Normalized `target_host: "localhost"` to `127.0.0.1` and preserved explicit ports (e.g. `localhost:3000`) instead of incorrectly hijacking to the first active route.
- **Windows updater elevation & file lock prevention**: Added `NSIS_HOOK_PREINSTALL` to force-kill remaining background processes (`horizon-gateway-serve.exe`, `hgc.exe`) and stop `WinDivert` service before extraction, and configured NSIS `installMode: "perMachine"` to ensure proper UAC elevation during auto-updates.

## [v2.8.2] - 2026-09-01

### Added

- **API log retention policy**: Configurable log retention policies with automatic cleanup and real-time frontend synchronization.
- **Asynchronous SQLite FTS batch indexing**: Background MPSC worker and single-transaction batches for high-throughput API log indexing without blocking the proxy.

### Changed

- **Proxy logging & memory optimization**: Selective JSON/Text payload logging with a 2MB capture cap to prevent memory spikes and I/O bottlenecks.
- **Host certificate LRU cache**: Capped `HostCertCache` at 500 hosts to conserve memory during high-concurrency traffic.
- **Frontend performance optimizations**: Virtualized log lists and heavy tree rendering optimizations in `DomainApiLogsPanel` and `JsonTreeView`.
- **Strict code linting & diagnostics**: Enforced Biome `noExplicitAny` and cleaned up Clippy compiler warnings across Rust crates.
- **Landing page & docs refresh**: Redesigned website landing page with animated logo, centered hero, updated product screenshots, and GTM positioning.

### Fixed

- **WinDivert NAT table session cleanup**: Handled TCP `FIN` / `RST` termination and 120s TTL session sweeps to prevent connection drops and localhost proxy freezes.
- **Dynamic theme synchronization port**: Resolved proxy port dynamically in `__root.tsx` so theme synchronization requests (`/.horizon-gateway/api/theme`) reliably reach custom proxy ports.
- **DaisyUI theme selector specificity**: Ensured `:root` and `[data-theme]` CSS custom properties inject with `!important` and purged legacy `#dynamic-theme` tags to prevent theme glitching.
- **Pipeline runner variable interpolation**: Fixed consecutive template variable interpolation bug in pipeline runner.
- **Mock rule headers & cookies**: Added URL-encoding fallback for non-ASCII header values and normalized `Set-Cookie` attributes case-insensitively.

## [v2.8.1] - 2026-08-18

### Fixed

- **Legacy data migration**: Watchtower → Horizon Gateway migration now merges domains by hostname instead of skipping when the new `domains.json` already exists. Old entries with hostnames not present in the new store are appended with fresh local ids; duplicate hostnames are left untouched. Other data files (groups, routes, mock rules, etc.) are copied only when missing in the new directory.
- **Migration cleanup**: After a successful merge the legacy `com.lurain.watchtower` directory is renamed to `com.lurain.watchtower.migrated` to prevent repeated migration and avoid the old data shadowing current settings.
- **Sync pull domain id collision**: Remote domain ids from workspace pull could overlap with local ids, corrupting the domain list. Pull now assigns free local ids for newly imported domains.
- **Sync panel not refreshing after pull**: The sync diff panel only bumped a counter instead of reloading the snapshot after push/pull/server edits, so the UI stayed stale until a manual page refresh.
- **Pull wiped all domains**: `importAllSettings` IPC dispatch passed the outer Tauri args wrapper `{ payload, mode }` directly to `serde_json::from_value::<SettingsExport>()`, which has no `payload` field. Serde defaulted every field (domains, groups, …) to an empty array, erasing all local data on every pull. The dispatch now correctly unwraps the inner `payload` object and forwards the `mode` string.

## [v2.8.0] - 2026-08-18

### Added

- **Bulk domain IPC**: `remove_domains`, `set_domain_groups`, `set_domain_api_logging`, `remove_domain_api_logging`, `update_local_route`, and `set_https_decrypt_host` accept optional `ids` / `domainIds` / `hosts` arrays so hub bulk actions hit the backend once.
- **Update handoff (`prepare_for_update`)**: The GUI stops the serve sidecar and waits for a clean exit before the updater installs, reducing file-lock failures on Windows.
- **Serve lifecycle events**: `serve-ready` and `backend-unavailable` Tauri events; bootstrap and hub subscriptions retry or refresh when the backend connects or drops.
- **Guide feature catalog & links**: Expanded `[[` aliases for global tools (API client/logs/mocking, schema, pipeline, crypto, preview, injection, proxy graph, monitor, server logs, policies). Policies resolve `hg://domain/:id/:panel` and open global hub surfaces from guide markdown.
- **Monaco guide editor**: Policy/guide description fields use `TsCodeEditor` with document-themed Monaco colors, markdown mode, domain-aware autocomplete, and styled suggest widgets in `global.css`.
- **Tools menu categories**: Global tools grouped into API & traffic, sandbox, and network/monitoring (including dedicated API logs and mocking entries).
- **PAC TLS bypass list**: Generated PAC scripts honor configured `tlsBypassHosts` (suffix and substring rules), not only loopback/Tailscale.
- **Default TLS bypass seeds**: Teams/Office/Skype, Slack, Zoom, Discord, and related SSO hosts are included and merged into existing installs.
- **Settings export resilience**: `.hg.json` import/export tolerates missing fields, camelCase/snake_case aliases, and default schema metadata; Rust unit tests cover partial payloads.
- **Inspector full theme tokenization & proxy sync**: All inspector components (guide modal, policy modals, traffic popovers, JSON/headers viewer, floating pins, editor) use CSS theme tokens; `/.horizon-gateway/api/theme` and disk persistence (`theme.json`) sync the active desktop theme to injected web pages in real-time.
- **watchtower-ui agent skill**: Documents section-title-outside-card layout, typography, spacing, and theme conventions for agents; linked from the horizon-gateway skill.

### Changed

- **Inspector SVG icons**: Replaced emoji and plain text icons with Lucide SVG icons and streamlined compact toolbar expand mode.
- **Custom themes (DaisyUI 5)**: Dynamic themes inject CSS variables on both `:root` and `[data-theme="<id>"]` with `data-color-scheme`, avoiding layer/specificity races with compiled themes.
- **Default typography**: Built-in light/dark presets use 13px base size and 1.4 line height.
- **Team workspace sync**: Pull payload carries `version`, `schemaVersion`, and `app` for consistent settings exchange.
- **Hub bulk actions**: Frontend bulk helpers batch decrypt, API logging, proxy routes, domain removal, and group assignment instead of per-id invoke loops.
- **Settings UI & proxy setup**: Section titles sit outside cards (watchtower-ui); shared `Card` `flat` / `bordered` / `subtle` variants; lighter field labels and `space-y-6` section rhythm; import normalizes partial exports before apply.
- **Hub panel chrome**: Tighter header/body padding and inline panel icons instead of boxed icon tiles.
- **Inspector bundle paths**: Vite copies `inspector.js` to `hg-serve` and `hg-gui` resources; serve resolves additional dev/cwd paths when loading the injection script.
- **Injection overlay**: Policy cluster recompute uses stable refs so annotation SSE no longer tears down listeners every tick; new/edit policy modals widen layout and share unified guide suggestions.

### Fixed

- **GUI startup race**: Initial app data load retries with backoff and clears backend-unavailable state when serve becomes ready.
- **Event forwarder reconnect**: When the backend flag is inactive but IPC ping succeeds, the GUI re-ensures serve and resumes SSE forwarding.

## [v2.7.10] - 2026-08-14

### Added

- **Hub overview controls**: HTTPS decrypt with inline help, an injection toggle, local destination, and the inspect list on the hub overview.
- **Guide editor**: CodeMirror with tab indent, auto-pair, `[[` feature links as `hg://`, recapture from injection, and error toasts with details.

### Changed

- **Host-row scoped toggles**: Routing, mocking, and inspector are controlled per host row. Global master switches are removed.
- **Guide host filter**: Matching is pattern-only; the guide popover layout is tightened.
- **DNS A/CNAME zone**: Removed from settings and the proxy DNS engine.
- **Paid checkout**: Gated off in production builds.
- **`tauri dev` leftover serve**: Development start resets a leftover `horizon-gateway-serve` process. Production still hides to the tray.

### Fixed

- **Proxy bind on port 8888**: Starting the proxy is more robust when the port is already owned by this app.

## [v2.7.9] - 2026-08-13

### Added

- **Close / minimize preferences**: The main window close button can hide to the tray or quit the app (with “remember this choice”). Minimize can stay on the taskbar or hide to the tray. Settings expose the same options, including ask every time.
- **Annotation SSE**: Injected pages subscribe to `/.horizon-gateway/api/annotations/stream` instead of polling every 2s, with a poll fallback after EventSource errors.

### Changed

- **Policies in the hub overlay**: UI/UX policies moved from a standalone route into a hub surface.
- **Window-behavior copy**: Tray hide vs taskbar minimize use the same, explicit labels.

### Fixed

- **Inspector toolbar in the GUI shell**: Production Vite no longer bundles `inspector.js` into the app window. Injection is a separate build, and the injector skips Tauri/localhost shell hosts.

## [v2.7.8] - 2026-08-13

### Added

- **`hgc` console CLI**: New asInvoker client (`hgc init`, `hgc list`, `hgc help <command>`, `hgc <command>` with implied `run`). No UAC. `horizon-gateway cli …` remains a compatibility wrapper that launches `hgc`.
- **Serve / GUI process split**: Headless `horizon-gateway-serve` owns proxy, storage, and IPC; the Tauri app is a thin shell that spawns serve (UAC on Windows) and forwards invokes over localhost.

### Changed

- **Windows admin manifest scoped to serve**: `requireAdministrator` applies only to `horizon-gateway-serve`, not `hgc` or lib tests.
- **Agent skill docs** use `hgc` as the primary command form.

### Fixed

- **`--query` on a running backend**: Live serve IPC now applies `--query` the same way headless `run` does.
- **`tauri dev` rebuild loop on Windows**: Debug builds no longer copy `serve.exe` into watched `resources/`, which previously retriggered rebuilds and could skip the Common Controls v6 manifest.
- **macOS / Linux release bundle**: Sidecars (`horizon-gateway-serve`, `hgc`) are packaged as `externalBin` instead of Windows `.exe` resources, so Unix `tauri build` no longer looks for `horizon-gateway-serve.exe`.

## [v2.7.7] - 2026-08-11

### Added

- **WinDivert transparent proxy commands (`start_transparent_proxy`, `stop_transparent_proxy`, `get_transparent_proxy_status`)**: Added transparent proxy service and CLI commands to capture outbound HTTP (80) and HTTPS (443) traffic at the kernel level for non-browser runtimes like Node.js (undici fetch), Java, and Python on Windows.
- **Outbound IP/TCP Destination NAT**: Integrated `etherparse` based raw packet header modification (`rewrite_ipv4_tcp_dst`) and session tracking (`NAT_TABLE`) to redirect outbound traffic to Horizon's local proxy port.
- **Single annotation lookup (`get_annotation`) and injection domain helpers (`add_injection_domain`, `remove_injection_domain`)**: Added dedicated CLI commands to query single annotations by ID and atomically add/remove script injection target domains.
- **`cli init --check` flag and outdated skill notices**: Introduced `--check` flag to inspect skill installation/update status without writing files, and outputs a notice to `stderr` when executing CLI subcommands with an outdated skill.
- **Automatic skill file sync (`build.rs`)**: Configured build script to copy master `.agents/skills/horizon-gateway/SKILL.md` to embedded app resources at compile time.

### Changed

- **CLI ↔ GUI proxy status synchronization (`proxy_runtime.json`)**: Persists runtime port and PID when starting proxy, enabling headless CLI queries to accurately detect active proxy state (`running: true`) via `load_active_state()` and 127.0.0.1 TCP probes.
- **Simplified `add_annotation` / `update_annotation` payloads**: Made `id`, `timestamp`, `selector`, `domain`, `hostPattern`, `pathPattern`, `tagName`, `content`, `thumbnail` optional in `add_annotation` for minimal agent payloads. `update_annotation` now allows updating partial fields like `role` / `description` independently.
- **Smart `cli init` auto-update**: Running `cli init` automatically updates outdated skill files without requiring `--force`, while avoiding redundant writes when skills are up to date.

### Fixed

- **CLI `Proxy stopped` status mismatch fix**: Resolved issue where CLI queries always returned `running: false` due to static memory isolation between GUI and CLI processes by utilizing runtime state verification.
- **WinDivert self-loop prevention and fallback**: Applied `processId != {pid}` filter to prevent re-capturing Horizon's own outbound traffic and added fallback handle initialization.
- **Windows CLI UTF-8 console I/O**: Applied WinAPI `SetConsoleCP(65001)` and `SetConsoleOutputCP(65001)` on Windows CLI execution to prevent Korean and UTF-8 string encoding corruption.

## [v2.7.6] - 2026-08-11

### Added

- **Visual coordinate badge clustering (`2+`)**: Automatically merges overlapping policy badges whose screen coordinates are within 24px or target the same element into a single stack badge (`2+`).
- **Multi-policy popup tab switcher**: Grouped cluster badges display a top tab bar (`[#2 ...] [#3 ...]`) inside the tooltip card, allowing one-click switching between overlapping policies.
- **Dynamic route & wildcard matching**: Extended `pattern.ts` to match Next.js/Nuxt dynamic params (`[id]`, `{id}`, `:id`, `[...slug]`) and N-level wildcards (`/*`, `/**`) on root (`/`) and deep subpages.

### Changed

- **Policy edit modal dark glass redesign**: Unified Watchtower main app's policy edit modal (`src/routes/ux/policies/index.tsx`) with injection script's sleek dark glass theme (`Edit3` icon, `Globe`/`FolderTree` icons, pink gradient save button).
- **Nested markdown list indentation**: Automatically detects leading whitespace/tabs in markdown guide content to render hierarchical sub-bullets (`• iframe...`) cleanly indented under parent numbered badges.

### Fixed

- **Popup card viewport clipping & off-screen floating gap**: Clamped popup card position and dynamic `maxHeight` so tooltips sit directly adjacent to badge dots without floating gaps, and remain strictly within 16px safety margins on all 4 viewport edges.
- **Post-scroll real-time cluster re-calculation**: Attached useCapture scroll and resize listeners (`window.addEventListener("scroll", ..., true)`) so badge overlap clusters continuously re-evaluate during page scrolling.

## [v2.7.5] - 2026-08-10

### Added

- **Annotation multi-strategy locators**: Guides store ordered locators (`testid` / `role` / `label` / `text` / `css`) instead of a single CSS selector; inspect capture builds a priority list, and legacy annotations migrate on load.
- **Locator validation & promote**: In-page badges show `ok` / `weak` / `broken` / `ambiguous`; weak guides with exactly one working fallback can promote that locator to primary (no silent rewrite).
- **CLI ↔ GUI annotation sync**: Running app watches `inspector_annotations.json` and emits `annotations-updated` when headless CLI writes; injection badges poll so agent edits appear without restart.
- **CLI guide docs**: Horizon Gateway skill documents annotation CRUD, query syntax, validation repair rules, and `url` → `pathPattern` helper behavior.

### Changed

- **Policies & injection UX**: Markdown guide rendering, edit/new policy modals, host/path pattern helpers, and clearer badge/toolbar copy for locator workflows.

### Fixed

- **`update_annotation` partial updates**: Omitting `hostPattern` / `pathPattern` no longer clears them; passing `url` alone derives `pathPattern` from the URL path.

## [v2.7.4] - 2026-08-07

### Fixed

- **Injection API fetch storm**: `useInjectionAppState` effects depended on whole hook return objects that change every render, causing an infinite loop of `status` / `proxy-routes` / `mock-rules` / `logging-domains` requests (hundreds per second). Dependencies now use only stable fetch callbacks.

## [v2.7.3] - 2026-08-07

### Fixed

- **TanStack Router Invariant Error Fix**:
  - Removed strict route constraint (`from: "/"`) in `usePanelNavigation`'s `useSearch` and `useNavigate` to prevent runtime crash (`Invariant failed: Could not find an active match from '/'`) when mounting `CommandPalette` on sub-routes or popup windows.
- **Theme & Null Safety Defense**:
  - Added defensive null checks and fallback mappings in `activeCustomThemeAtom` and `applyThemeToDocument` to prevent render exceptions when `localStorage` theme state is invalid or partial.
- **Enhanced ErrorBoundary Diagnostics**:
  - Upgraded `ErrorBoundary` to display error stack traces, component stacks, and a `Reset local storage` recovery action.

## [v2.7.2] - 2026-08-07

### Added

- **`Ctrl+P` Command Palette & Naming Specification**:
  - Implemented 24 structured multilingual fuzzy-search commands across 7 categories (`[Domain]`, `[Proxy]`, `[Mocking]`, `[Tool]`, `[Log]`, `[Settings]`, `[Team]`).
  - Multi-step form engine (`Select`, `Autocomplete`, `Input`) with seamless focus management.
- **Custom Theme & Font Editor (`chrome/theme`)**:
  - Built full color palette editor with 10 grouped color pickers including contrasting text colors (`primaryContent`, `secondaryContent`, `accentContent`) and local system font detection (`local()`).
  - Added `.hgtheme.json` Export/Import support.

### Changed

- **TopBar Popover Menu Integration**:
  - Placed `🎨 Theme & Font Editor` item inside TopBar Settings Popover menu list.
- **Profile UI Refactoring**:
  - Removed avatar theme color swatch and dark profile background; streamlined inline layout for name, role, and language.

### Fixed

- **Command Palette GPU Rendering Bottleneck**:
  - Removed modal `backdrop-blur-sm` filter to eliminate GPU frame drops on Windows WebView2.
- **Keystroke IPC Latency**:
  - Fixed autocomplete step to load data ONCE on open and perform in-memory fuzzy filtering for 60fps instant keystroke response.
- **ErrorBoundary Layout**:
  - Centered crash recovery UI across full window height (`min-h-screen`, `h-full`).

## [v2.7.1] - 2026-08-07

### Added

- **Server resource admin editor**: Owner/Admin can add, edit, or delete workspace server items (domains, mock rules, groups, scenarios, group links) with forms—without a full Push overwrite.

### Changed

- **Domain sync labels**: Display domains without mixed `http(s)://` prefixes for consistent scanning.
- **Shared Modal**: Smaller radius (`rounded-xl`), tighter padding, and non-clipping headers so confirm dialogs stay readable.

### Fixed

- **Mock rule sync list**: Matching now includes host and name, and duplicate method/path rows no longer collapse—so all server mocks appear in the Pull list.

## [v2.7.0] - 2026-08-06

### Added

- **Team sync browser**: Push/Pull split diff view with per-kind catalog, conflict details for scenarios, and snapshot-based diff without re-fetching on every tab switch.
- **Workspace onboarding**: When no workspaces exist, show a centered create/join form instead of an empty list.
- **Owner workspace management**: Rename or delete a workspace (name confirmation modal), remove members, transfer ownership, and grant/revoke Admin (Owner-only UI).
- **Member action confirm modal**: Replaced `window.confirm` for Admin grant/revoke with a dedicated confirmation dialog.

### Changed

- **Group link sync rows**: Domain URL is shown as the primary label; group name appears as secondary text for easier scanning.
- **Admin invite gate**: Invite codes and token management are limited to Owner and Admin roles in the UI.
- **Domain sync matching**: Host-based matching compares only `enabled`; URL differences surface as informational detail instead of false conflicts.

### Fixed

- **Sync filter selection**: Select-all / clear now applies correctly to the filtered list.
- **Sync empty states**: Clear guidance when a category has no local or remote items.

## [v2.6.10] - 2026-08-06

### Added

- **Team Workspace Full-View UI**: Rebuilt the team experience as a DomainHub-style L→R panel stack (workspace list · home · members · sync · billing). Unified `/team` and Chrome team surface entry points.

### Changed

- **InjectionApp modular split**: Split the ~3200-line monolith into `api/`, `hooks/`, `ui/`, and `lib/` modules for easier maintenance.
- **Simpler injection gate**: HTML injection now depends only on registered domains plus the `injection_domains` list, not the global Inspector On/Off flag. Removed the global toggle from Inspector settings and the `Ctrl+Alt+I` shortcut.
- **No injection UI heartbeat polling**: Early interceptor already observes fetch/XHR traffic, so the 2.5s polling of `status`, `proxy-routes`, and `logging-domains` was removed; data refreshes when popovers open.

### Fixed

- **Missing XHR API calls**: Fixed early interceptor `XMLHttpRequest.send` using `apply(this, body)`, which broke POST/JSON requests; now uses `apply(this, arguments)` (e.g. `GetContentAndTerms`).
- **Removed fetch double-wrap**: Stopped re-patching fetch/XHR in InjectionApp, which could block some page APIs.

## [v2.6.9] - 2026-08-06

### Added

- **Selective Workspace Sync Modal**: Match key, overlap policy, domain-kind filters, and per-domain selection when pushing/pulling team workspace domains.
- **Toolbar Update Badge**: Shows when an update is available; click installs it from the title bar.
- **Clearer Team Member Identity**: Prefer display name with email secondary; editable display name when logged in; peer profiles visible to workspace members.

### Fixed

- **inspector.js stub in production/dev**: Bundle `inspector.js` as a Tauri resource, resolve it via resource/exe/manifest paths, and embed it at build time so `/.horizon-gateway/inspector.js` no longer serves the “run pnpm build:injection” warning stub.
- **Missing HTML injection**: Inject the inspector script before `</html>` (or at document end) when `</body>` is absent, and complete partial injections that only had the early interceptor.
- **Domain duplicate / sync matching by hostname**: Normalize and match domains by hostname so scheme/path/port variants are treated as the same host.

## [v2.6.8] - 2026-08-06

### Added

- **Duplicate Domain Detection & Merge Policy Modal**: Added automatic detection for duplicate domain URLs across the local list and team workspace. Displays a warning banner and provides a dedicated Proxy-styled Merge Policy Modal with 3 consolidation strategies (`Smart Merge`, `Keep Latest`, `Keep Oldest`).
- **Domain Settings Comparison View**: Added a 2-column comparative card view per domain ID inside the Duplicate Merge modal. Displays group assignments, proxy targets, monitor statuses, and API logging badges side-by-side to make informed decisions when picking primary domain IDs.
- **Multi-Mode Workspace Domain Sync**: Added 4 selectable sync strategy modes (`URL-based Merge`, `Append Only`, `Complete Overwrite`, and `Strict Internal ID`) in the Team Workspace sync modal, enabling seamless domain list synchronization across different accounts and devices without ID collisions.

### Changed

- **UI Refinement & Modern Border Radii**: Refined border-radius properties (`rounded-3xl` / `rounded-2xl` lowered to sleek `rounded-xl` / `rounded-lg` / `rounded-md`) across modals and cards for a sharper, premium desktop aesthetic.
- **100% SVG Vector Icons**: Replaced all plain text emoji icons (`🌐`, `➕`, `⚠️`, `🆔`, `⚡`) with high-quality Lucide SVG icons (`Globe`, `Plus`, `AlertTriangle`, `Fingerprint`, `Zap`, `Server`, `Shield`).

## [v2.6.7] - 2026-08-06

### Added

- **Realtime Workspace Invitation Notifications & Inbox UI**: Added Supabase Realtime event listeners for workspace invitations. Users receive instant toast notifications upon receiving an invite and can view a "Received Workspace Invitations" inbox card to accept or decline invites with 1-Click.
- **Shareable Public Invite Tokens**: Added support for generating open invite tokens (`Shareable Token`) that allow team members to join via shared links (e.g. Slack/KakaoTalk) without specifying recipient emails in advance.
- **Manual Invite Token Revocation UI**: Added a 1-Click `Revoke` button to the pending invites list, allowing workspace admins to manually expire/cancel pending or shareable invite tokens at any time.

### Fixed

- **Supabase Invitation RLS Permission Policy**: Fixed RLS 403 Forbidden errors when joining a workspace via manual token paste or shareable token by adding `status = 'pending'` condition to `workspace_invites` SELECT and UPDATE policies.
- **Workspace Admin Check Policy**: Updated `is_workspace_admin()` helper function to include `workspaces.owner_id = auth.uid()` so workspace owners have administrative invite permissions before member row creation.

## [v2.6.6] - 2026-08-06

### Added

- **Team Workspace Domain List Sync (Phase 1)**: Introduced team workspace domain and group list synchronization via explicit Push/Pull actions. Teams can now share domain registries, groups, and mock rules safely across members without sharing sensitive CA certificates, tokens, or packet logs.
- **Free Tier Policy & Workspace Guard**: Added `useWorkspaceGuard` to enforce Free Tier limits (1 owned workspace, max 3 member seats). Displays upgrade callout banners and locks sync actions when seats are full or subscription is past due.
- **Pending Invite Token Management & Direct Copy**: Automatically copies generated invite tokens to the clipboard upon invitation and adds a "Pending Invites" list UI with a 1-click token copy button for convenient manual sharing.
- **Social sharing Open Graph meta tags**: Added Open Graph and Twitter Card meta tags to the official website landing and Changelog pages. Sharing `https://gateway.delete-horizon.com/ko/changelog/` on Kakao, Microsoft Teams, Slack, LinkedIn, and similar platforms now renders a rich card preview with title, description, and image.
- **OG share image**: Added a Horizon Gateway logo-based 1200×630 PNG OG image (`og-image.png`) and a build script that auto-generates it from the SVG source during the website build pipeline.

### Changed

- **Workspace Sync UX Refactoring**: Removed the redundant sync toggle switch in `TeamSection`. Push and Pull buttons are now directly visible and accessible upon selecting an active workspace.
- **Website canonical and OG URL setup**: Set Astro `site` to `https://gateway.delete-horizon.com` and added `canonical`, `og:url`, `og:site_name`, `og:locale`, and image dimension/alt meta tags.
- **Changelog page share description**: Changelog URL shares now use a changelog-specific description instead of the landing page copy.

### Fixed

- **Supabase Workspace & Resource RLS Policies**: Fixed RLS 403 / 42501 errors during workspace creation and resource pushing by updating `is_workspace_member()` and workspace SELECT policies to explicitly grant access to workspace owners (`owner_id = auth.uid()`).
- **Production inspector.js serving**: Fixed `/.horizon-gateway/inspector.js` failing to locate the bundled resource in release builds, which caused only a warning stub to be served. The path is now resolved via Tauri `resource_dir()` so the injection script is served correctly in both dev and production environments.

## [v2.6.5] - 2026-08-05

### Added

- **Declared API-only traffic logging**: Injected inspector now only logs traffic for domains explicitly declared in Horizon Gateway's API logging settings. Traffic from unrelated 3rd-party origins (CDN, analytics, media) is silently ignored.
- **Offline proxy fallback error page**: When the local proxy target (e.g. `localhost:3000`) is unreachable, the browser now renders a styled error page with the injected Horizon Gateway UI still active, allowing users to toggle proxy routes without being stuck on a blank page.

### Changed

- **Mock API unified detail & editor modal**: Merged the read-only detail view and the edit form into a single modal. The title dynamically changes between `"모킹 API 상세 및 편집"` and `"신규 모킹 규칙 작성"` based on context.
- **Mock list SVG icons**: Replaced all emoji text icons (`⚡`, `➕`, `✏️`, `🗑️`, `👁️`) in the MCK popover and modal with clean SVG icons.
- **PRX popover exact host matching**: Fixed domain route matching in the injected PRX popover to use strict equality (`hostname === domain`) instead of `includes` / `endsWith`, preventing unrelated subdomains from appearing under the current host's route list.
- **Error boundary branding**: Renamed injected script error message from `Watchtower Error` to `Horizon Gateway Error`.

### Fixed

- **Mock ON/OFF toggle**: Fixed `handleToggleMockRule` to correctly handle both saved backend `MockRule` (toggle via `/api/mock-rule/toggle`) and unsaved `MockedApiEntry` traffic captures (auto-save then enable via `/api/mock-rule/save`).
- **Traffic log stale closure bug**: Fixed a React closure bug where `logTraffic` inside the `fetch`/`XHR` patch `useEffect` always read an empty `loggingDomains` array (captured at mount time). Replaced with a `loggingDomainsRef` that stays in sync with state, ensuring newly declared domains are respected without re-patching the network layer.
- **Early interceptor log re-sync**: Added a `useEffect` that re-syncs the early interceptor's `__wt_api_traffic_logs` buffer against `loggingDomains` once the API fetch completes, recovering logs captured before React finished mounting.

## [v2.6.4] - 2026-08-04


### Added

- **API Body Logging Toggle Options**: Restored options to toggle HTTP Body (Request/Response) logging ON/OFF in both the API logs toolbar (`DomainApiLogsPanel`) and the full-screen schema options page (`/apis/schema`).

## [v2.6.3] - 2026-08-04

### Added

- **OpenAPI Schema Management & Inline Download**: Restored the OpenAPI schema URL registration and sync download interface across the Domain Overview panel (`api/schema`) and the Global Schema Explorer (`/apis/schema`). Users can now register, save, and download OpenAPI spec URLs directly from domain cards or empty explorer state cards.

### Changed

- **Domain Overview API Menu Layout**: Unified spacing, icon alignment, and hover effects for `API Logs`, `API Schema`, and `API Mocking` under a cohesive single-column layout in `DomainOverviewPanel`.
- **Global Schema Explorer Domain Selection & Spacing**: Expanded the target domain dropdown to list all registered API domains (including those without pre-loaded schemas) and added consistent border padding (`p-3 sm:p-4` / `px-4 pb-4`) for embedded surface overlays.

## [v2.6.2] - 2026-08-04

### Added

- **Automatic script injection on active Proxy / Mocking / Logging**: Script injection (`inspector.js`) and the target app status bar widget now automatically run whenever Proxy, Mocking, or Logging is active for a host, eliminating the need to manually toggle the inspector switch.

### Changed

- **HTTPS selective decryption for Mocking**: Expanded `should_decrypt` HTTPS CONNECT tunneling logic to decrypt traffic when Mocking or Logging is enabled for a domain, ensuring HTTPS sites properly inject status bars and apply mock rules.
- **Accurate Proxy status detection**: Updated `/.horizon-gateway/api/status` to accurately compute `proxy` status based on `is_local_routing_enabled` and active local routes (`proxyCount`), preventing false-positive proxy status indicators.
- **Injected status bar Branding & UX**: Replaced text toggle ("W" / "⋮") with official Watchtower SVG logo (`/.horizon-gateway/logo.svg`), adding a subtle glow effect during inspect mode for a polished branding experience.

## [v2.6.1] - 2026-08-01

### Added

- **API log body search**: Free-text search over request/response bodies via daily SQLite FTS5 sidecars, with progressive hit events for the logs UI.
- **Adaptive param indexing**: `key=value` body scans learn unknown query/body keys into `indexed_params.json` and backfill the param index for faster later lookups.

### Changed

- **API log storage split**: Daily storage now separates lightweight meta (`.meta.jsonl`) from per-entry body files, with list/detail APIs and legacy `.jsonl` dual-read for compatibility.
- **API log list UX**: Domain and overview log panels refresh from `api-log-captured` events instead of polling; row clicks hydrate full detail on demand.
- **Proxy connection map filters**: Group chips, route status filters (active/inactive/unrouted), and persisted search on the proxy graph view.
- **Domain API logs navigation**: Opening "API logs" from the domain overview/API panel stacks into the right-hand panel column instead of the full-screen global surface.

### Performance

- **Today meta cache & write path**: In-memory cache for today's summaries, per-date write locks, body size caps, and pass-through traffic that no longer writes disk logs when logging is off.

## [v2.6.0] - 2026-07-23

### Added

- **Internal API request logging**: Internal API test calls (Schema Try-it-out `send_api_request`, Pipeline API nodes) now route through the local proxy server when active, recording network API logs when logging is enabled for the target domain.

### Performance

- **API log detail fetching**: Optimized `fetchApiLogById` to query log dates in parallel via `Promise.all`, resolving slow loading times when fetching detailed log entries across multiple log files.

## [v2.5.4] - 2026-07-16

### Changed

- **Group card grid**: Replaced the fixed two-column layout with responsive `auto-fill` columns (320px minimum card width) so group cards use overlay and popup panel width more efficiently.

### Fixed

- **Group management list loading**: Shared hub data `loading` state across all `useDomainHubData()` callers so the groups overlay no longer shows an infinite spinner after the main hub has already loaded group data.

## [v2.5.3] - 2026-07-14

### Changed

- **Fluent overlay scrollbars**: Main and secondary windows use WebView2 `fluentOverlay` scrollbars so lists and panels scroll without classic ↑↓ buttons.
- **Theme-aware scrollbar polish**: App-wide thin pill thumbs follow light/dark `base-content`, without relying on Chromium `scrollbar-width` (which forced Windows fluent arrows).

### Fixed

- **Windows GUI console window**: Release builds use the windows subsystem so Explorer / Start Menu launches no longer open a CMD log window. CLI mode attaches to the parent console only when stdout/stderr are not already redirected, preserving pipe capture for agents.

## [v2.5.2] - 2026-07-14

### Added

- **Bilingual & Extensible Update Changelogs**: Added a premium, glassmorphic update notification modal that automatically triggers upon the first application run after an upgrade.
- **Top Bar Settings Integration**: Added a "Changelog" option in the Settings dropdown menu to allow users to review historical update logs at any time.
- **Dynamic Markdown Parsing**: The application dynamically parses the raw content of root `CHANGELOG.md` and `CHANGELOG.ko.md` files at compile-time, ensuring a single source of truth and lag-free virtualized scrolling for the entire version history.
- **Complete Korean Release History**: Created `CHANGELOG.ko.md` at the root of the project, containing the full translated release notes down to `v1.0.0` for the website and app.

## [v2.5.1] - 2026-07-14

### Changed

- **App rebranding completion**: Migrated remaining files, internal variables, directories, and selectors from `watchtower` to `horizon-gateway`.
- **Robust data migration**: Added robust app data migration logic that checks for existing user databases (like `domains.json`) and copies configuration files seamlessly, ensuring no settings or domain lists are lost when upgrading.

## [v2.5.0] - 2026-07-13

### Added

- **Supabase Authentication & Database Integration**: Supabase JS SDK integrated into the app. Supports Social OAuth login using GitHub.
- **Tauri v2 Deep-Link Routing**: Enabled custom URL scheme handler (`horizon-gateway://`) with Windows Registry auto-registration on startup.
- **Windows Single-Instance & Arg Forwarding**: Added `tauri-plugin-single-instance` to prevent multiple window spans. Implemented manual CLI argument parsing to route OAuth callback URL params to the active main window without communication drops.
- **GitHub Sponsors Integration**: Shifted developer donation platform to GitHub Sponsors to avoid payment service restrictions in Korea. Includes visual pulsing Rose button theme.
- **Early Access Labs & Developer Feedback**: Added user settings page options for experimental features (locked behind Sponsor status) and direct feedback forms inserting reports into Supabase DB.
- **Consolidated Settings & Clean Profile Dropdowns**: Reorganized TopBar buttons. Infrastructure configuration merged inside the new click-based Settings dropdown menu. Profile settings and logout buttons unified under a click-based dropdown menu with all visual headers removed.
- **Minimal Design Chevron Removal**: Removed Chevron indicators on TopBar menu buttons to achieve consistent minimal icon+text layout.
- **Automatic GitHub Profile Sync**: Automatic local name and avatar picture synchronization using OAuth user metadata.

### Changed

- **App rebranding**: Continued name and configurations migration from `watchtower` to `horizon-gateway`.
- **Tauri Opener Bypass**: Handled external URL navigation through custom Rust back-channel `open_external_url` to bypass Tauri opener limitations.

## [v2.4.4] - 2026-07-10

### Added

- **API Logs bulk HTML export**: Select multiple API log entries and download them as a single HTML report with table of contents, per-entry copy actions, and scrollable long bodies.
- **Save & reveal folder**: HTML export uses the native save dialog (Tauri) and offers "Open folder" after a successful save via `revealItemInDir`.
- **Shared download helpers**: `saveTextDownload`, `revealInFolder`, and `offerRevealSavedDownload` for reusable file export flows.

### Changed

- **HTTP body display**: `formatHttpBody` restores literal `\n` / `\t` escapes and unwraps double-encoded JSON strings so exported/copied bodies read closer to the original payload.
- **HTML card escaping**: API exchange HTML cards escape user content before embedding in `<pre>` / headers.

## [v2.4.3] - 2026-07-10

### Added

- **DisabledPanel**: Panels for features not available on the selected domain are now shown in a disabled state instead of being silently reset to `overview`. Users can see which features are inactive and enable them directly from the panel.
- **Bulk URL Copy**: New bulk toolbar (`DomainListBulkToolbar`) exposes a "Copy URLs" action that copies all selected domain URLs to the clipboard in list order.
- **Bulk range & toggle select**: Shift+click for range selection and Ctrl+click for individual toggle are now supported in bulk mode with a visual hint.
- **`HubSurfaceEmbedContext` dismiss callback**: `HubSurfaceEmbedProvider` now accepts an `onDismiss` prop and exposes `useHubSurfaceDismiss()`. Embedded surfaces (e.g. Add Domain opened from the overlay) close the overlay rather than the Tauri window.
- **i18n**: Added `bulkCopyUrls`, `bulkCopied`, `bulkSelectionHint` strings to both `en` and `ko` locales.

### Changed

- **Panel depth preserved on domain switch**: Switching domains no longer resets the panel stack to `overview`. The current depth is kept; panels for disabled features render in a disabled state.
- **Bulk mode not persisted**: `domainListBulkModeAtom` changed from `atomWithWindowStorage` to a plain `atom` — bulk mode resets on page reload to avoid stale UI state.
- **Bulk selection type**: `domainListBulkSelectedIdsAtom` changed from `number[]` to `ReadonlySet<number>` for O(1) membership checks.
- **Domain list refactored**: `DomainListItem`, `VirtualizedGroupedDomainList`, and `DomainListInteractionContext` extracted from `DomainListPanel` for maintainability.
- **`applyNavigation` helper**: Synchronously updates both Jotai atoms and internal refs before pushing the URL, eliminating a race where stale refs caused double navigation.

### Fixed

- **Stale ref race on domain deselect / clear**: `selectDomain`, `clearDomain`, and `restoreNavigation` now use `applyNavigation` to keep `domainIdRef` / `panelsRef` in sync with state before URL navigation.
- **Redundant panel resets**: Removed the `useEffect` that reset panels to `overview` whenever the active panel was inaccessible — replaced by `DisabledPanel` rendering.

## [v2.4.2] - 2026-07-09

### Fixed

- **Windows CLI pipe output**: Dropped unconditional `AttachConsole` / stdio rebinding (v2.4.1 regression). Release builds now use the console subsystem so `spawn`, pipes, and file redirection capture stdout reliably.
- **GUI console flash**: Hide the console window on non-`cli` launch via `GetConsoleWindow` + `ShowWindow(SW_HIDE)`.

### Changed

- **SKILL.md**: Updated Windows notes — pipes/spawn work natively; `Out-String` is optional.

## [v2.4.1] - 2026-07-09

### Fixed

- **Windows CLI console output**: After `AttachConsole`, rebind stdin/stdout/stderr via `CONIN$`/`CONOUT$` so PowerShell and cmd show JSON output synchronously without requiring `| Out-String`.

### Changed

- **SKILL.md**: Added Windows PowerShell tips (JSON escaping, `@file` payloads, `Out-String` fallback).

## [v2.4.0] - 2026-07-09

### Added

- **Proxy Connections Graph View**: Added an interactive graph view (`global/proxy-graph`) that visualizes connections between domains and local proxy targets (host + port) using SVG Bezier curves with flowing traffic animations. Supports toggling route status, inline host/port editing, and adding/removing routes directly.
- **List Virtualization**: Integrated `@tanstack/react-virtual` in the domain list to support efficient rendering and eliminate UI lag when managing hundreds of domains.
- **Smart Sorting**: Prioritizes domains with enabled proxy routes at the top, followed by disabled proxy routes, and places unconfigured domains at the bottom of the list.
- **Headless `cli run`**: `watchtower cli run` now bootstraps services without Tauri/WebView and exits after JSON output — safe for agents, CI, and non-interactive terminals.
- **`AppContext` runtime**: Shared service bootstrap for GUI and CLI (`runtime/app_context.rs`, `runtime/paths.rs`).
- **Payload file/stdin**: `cli run <cmd> @payload.json`, `cli run <cmd> -`, or `--payload @file` for PowerShell-friendly input.
- **Command `*_svc` layer**: Tauri commands delegate to reference-based service functions; headless dispatch uses `cli/dispatch_headless.rs`.

### Changed

- **`main.rs` routing**: `cli init|list|help` and `cli run` exit before `watchtower_lib::run()`; only bare `watchtower` starts the GUI.
- **GUI `cli run`**: Still supported when launched from the desktop app process (Tauri setup intercept).

### Known limits

- **`start_local_proxy` headless**: Requires GUI `AppHandle` for proxy runtime (v2.4.1 candidate).
- **GUI + headless CLI**: Avoid running `cli run` while the GUI app is open if both write the same settings.

## [v2.3.1] - 2026-07-09

### Added

- **Sandbox Library CLI**: Persisted pipeline library, JSON Schema registry, and crypto presets to app_data (`pipelines.json`, `json_schemas.json`, `crypto_presets.json`) with full CRUD + import commands for agents (`get/create/update/delete/import_*`).
- **CLI Command Metadata**: `cli list` / `help` now include `category` and `guiOnly` so agents can filter GUI-only window/dialog commands.
- **CLI Specta Parity Tests**: Added regression tests that keep `CLI_COMMANDS`, `dispatch_command`, and `collect_commands!` in sync.

### Fixed

- **CLI list/run Parity**: Wired `update_local_route`, `add_annotation`, `update_annotation`, `delete_annotation`, and `import_annotations` into `dispatch_command` so commands shown by `cli list`/`help` no longer fail on `cli run`.
- **Agent Payload Examples**: Corrected broken `payload_example` values for `add_annotation`, `import_annotations`, `create_mock_rule_from_log`, and `import_all_settings`.
- **CLI Description Typos**: Fixed inspector/window/settings description typos and marked GUI-only commands with `[GUI]`.

### Changed

- **Agent Skill Docs**: Expanded bundled `SKILL.md` with recommended commands by task, CLI limits, and sandbox library examples; synced to `.agents/skills/watchtower/`.
- **Sandbox Bootstrap**: On app start, migrates localStorage sandbox libraries into Rust storage when app_data is empty, then hydrates FE atoms from the backend.

## [v2.3.0] - 2026-07-08

### Added

- **Hub Handoff & Overlay Surfaces**: Added structured handoff flow from API log detail to global/domain targets (mocking, schema explorer, JSON schema registry, crypto, pipeline) with `?g=` global overlay navigation.
- **Schema Explorer Global Surface**: Added global schema explorer surface with OpenAPI endpoint pre-selection from handoff metadata (method/path matching).
- **Hub Context Bar**: Added contextual header showing selected domain, M/P/A badges, and all-domain API logs shortcut.
- **Hub Event Sync for Detached Windows**: Added handoff event broadcast/sync so detached windows can receive and apply hub navigation intents.
- **Bulk API Body Logging Toggle**: Added nested support for toggling API body logging (`bodyEnabled`) status across multiple domains in bulk manage mode.

### Changed

- **Bulk Manage UI/UX Redesign**: Redesigned the Bulk Manage panel to feature toggle cards resembling the specific Domain Overview panel, including status badges (ON/OFF/Mixed) and animated loaders per card.
- **Crypto Tool Navigation**: Moved crypto flow from domain 2-depth panel to global surface-first usage in handoff/navigation.
- **Proxy Route Model**: Switched local proxy routes to domain FK-based linkage (`domain_id`) and synchronized hostname cache from domain URL.
- **Settings/Infrastructure Controls**: Exposed `local_routing_enabled` toggle in both settings and infrastructure UIs for consistent control.

### Fixed

- **Ghost Proxy Routes**: Prevented orphan proxy routes by validating domain linkage on CUD, syncing routes with domain list, and cascading delete on domain removal.
- **Route/Domain Matching Drift**: Normalized and synced route host values from domain URL updates/import flows to avoid stale proxy badges and mismatched management states.
- **Schema Explorer Runtime Navigation Error**: Fixed active route mismatch/invariant failures when opening schema explorer via hub surface.

## [v2.2.0] - 2026-07-08

### Added

- **Domain Hub**: Replaced the legacy sidebar/dashboard home with a domain-centric hub — panel stack navigation, domain overview, and per-domain monitor/proxy/API/debug panels.
- **Popup Windows**: Detached popup routes for infrastructure, tools, settings, domain registration, and group management.
- **Embed Mode**: Standalone window routes for server logs, API tools, UX policies, profile, and related pages without the main hub chrome.
- **Domain List UX**: Search, group/feature filters, sort, M/P/A badges, persisted filter state, and bulk manage mode (feature toggles, group assign, delete).
- **Panel Collapse & Overlay**: Collapsed panel strips with `>` inline expand and tab-click slide-over preview; domain list strip at depth 4+ with the same pattern.
- **API Log Polish**: Exchange copy dropdown (HTML/Markdown), log detail panel, path/method search in domain API logs, and overview deep links.
- **Domain API Mocking Panel**: In-hub CRUD for mock rules with i18n.
- **domain-hub Entity**: Hub data subscription with reason-based partial refresh.

### Changed

- **Navigation**: Root route is now the Domain Hub; legacy sidebar and dashboard feature removed.
- **FSD Layout**: Panel stack, popup-window, and domain-hub entities reorganized for clearer feature boundaries.
- **Domain List Width**: Fixed 420px width when visible; no shrink on domain selection (strip only at panel depth 4+).

### Fixed

- **Panel Gates**: Block monitor/API panel entry when features are disabled; proxy remains accessible.
- **Performance**: Memoized domain list rows, reduced re-renders on selection, and lighter panel transitions.

## [v2.1.4] - 2026-07-07

### Fixed

- **CLI Hang on Standalone Subcommands**: Resolved an issue where the CLI would hang indefinitely when running standalone subcommands (e.g. `watchtower cli list`) by bypassing full Tauri initialization for non-GUI commands. Also fixed stdout redirection on Windows to ensure terminal output is visible when invoked from the command line.
- **GitHub Pages Subpath Routing**: Configured Astro `base` path to `/watchtower` to correctly resolve all asset and page URLs under the GitHub Pages subdirectory.
- **Website Image 404 on GitHub Pages**: Prefixed hero title logo and social share images with the Astro `base` URL to prevent 404 errors when served from the `/watchtower` subpath.

### Changed

- **CI Optimization**: Skip GitHub Actions CI test runs for commits that only affect website or documentation files, reducing unnecessary Actions usage.

## [v2.1.3] - 2026-07-07

### Added
- **Unified Branding & Logo System**: Introduced a new symmetric `WATCH {로고} TOWER` branding logo with an integrated micro brand icon.
- **Logo Sync Automation**: Created `scripts/sync-logos.mjs` to automatically propagate branding SVGs from the root `public/` directory (Single Source of Truth) to the website assets at dev/build time.
- **GitHub Pages Deploy Action**: Added `.github/workflows/deploy-web.yml` to automatically build and deploy the website to GitHub Pages on website changes or after `Release` workflow completion.

### Changed
- **Website Layout & Routing**: Extracted website routes to `/ko` and `/en` subdirectories, added auto browser language detection and redirection at root `/`, and updated header/footer navigation to render the new symmetric logo.
- **Desktop Application Branding**: Replaced old logo and text in desktop app's `Titlebar.tsx` and `Sidebar.tsx` with the new unified `logo-text.svg`.
- **CLI Command in Documentation**: Updated website copy box command to `watchtower cli init --project` for active agent skill initialization.
- **Local Signer Configuration**: Configured working `.env` and `tauri.conf.json` updater signing keys to facilitate local release builds and testing.

## [v2.1.2] - 2026-07-07

### Added

- **Windows CLI Console Attachment**: Configures release builds on Windows to dynamically attach to the parent console (`AttachConsole`) in CLI mode, ensuring `println!` outputs are visible when run from the command line.

## [v2.1.1] - 2026-07-07

### Added

- **Installer PATH Option**: Added a custom user-consent confirmation prompt during Windows (NSIS) installation to safely append the `watchtower.exe` installation directory to the user's `PATH` environment variable.
- **Silent Mode Handling**: Integrates `IfSilent` checks in the installer post-install hook to bypass the PATH prompt and modification during background auto-updates, ensuring smooth updates.
- **Installer PATH Cleanup**: Automatically cleans up the user's `PATH` environment variable on uninstallation.

## [v2.1.0] - 2026-07-06

### Added

- **Headless CLI Mode**: Run `watchtower cli list`, `help`, and `run` from the terminal without launching the GUI. All Tauri commands are exposed with JSON payloads and optional `--query` projection for token-efficient agent output.
- **Agent Skill Installer (`cli init`)**: Install bundled `SKILL.md` and `logs.mjs` to coding-agent skill directories (`cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`, `all`, or `auto`). Supports `--project` for `.agents/skills/watchtower/` and `--print` to output skill content without installing.
- **Disk Log Reader Script**: `logs.mjs` reads API logs directly from the app data directory (Windows, macOS, Linux) without starting Watchtower — bundled for agent skill distribution.
- **Tauri Env Loader**: `pnpm tauri` now loads `.env` via `scripts/tauri-env.mjs` before invoking the Tauri CLI.

### Changed

- **CLI Log Verbosity**: Suppresses trace/debug logs in CLI mode (`LevelFilter::ERROR`) to keep agent-facing stdout clean.

## [v2.0.1] - 2026-07-06

### Changed

- **Client-Side API Log Filtering**: Refactored the API Logs view (`src/routes/apis/logs/index.tsx`) to fetch all logs for the selected date and apply filters (method, host, path/search) client-side using `useMemo`. This replaces server-side filtering on input change, eliminating excessive API request firing and improving responsiveness.

### Fixed

- **Mock Rule Card Layout Overflow**: Fixed layout overflow issues on the Mocking page rules dashboard cards (`src/routes/apis/mocking/index.tsx`) by introducing proper flex container bounds (`min-w-0`, `flex-1`, and `shrink-0`) to truncate long URL patterns and hosts gracefully without breaking action buttons.
- **FlowBuilder Props Mapping Formatting**: Cleaned up code layout and formatting rules inside mapping functions in the sandbox FlowBuilder component (`src/features/sandbox/ui/FlowBuilder.tsx`).

## [v2.0.0] - 2026-06-28

### Added

- **Sandbox Data Pipeline JSX/TSX Monaco Editor Integration**: Upgraded the plain `textarea` React Component code editor in the Sandbox Data Pipeline properties panel to use the high-performance `TsCodeEditor` (Monaco).
  - Enables full TSX/JSX syntax highlighting, auto-formatting, and autocomplete suggestions.
  - Dynamically resolves properties and structures based on either the pipeline's runtime output data (dynamic props from parent nodes) or the selected JSON validation schema.
- **Dynamic Live Rendering Canvas Nodes**: Upgraded the Preview Node (`PreviewNodeComponent`) on the ReactFlow canvas to compile and render your JSX code inside a nested live rendering iframe directly inside the graph layout after successful pipeline execution.

### Fixed

- **Monaco Multi-Editor Input Collision**: Resolved a critical bug where having multiple Monaco editors (e.g. Target Keys, Source Expressions, and Preview code) active simultaneously would cause keyboard inputs to freeze or values to overwrite each other.
  - Generates unique in-memory model paths (`file:///preview_${editorKey}.tsx` etc.) for each editor instance to isolate Monaco text buffers.
  - Scopes global autocomplete providers and type definitions (`.d.ts` declarations) to their respective editor instance to prevent token bleeding.

## [v1.8.1] - 2026-06-11

### Fixed

- **Next.js HMR WebSocket Proxy Connection**: Resolved connection failures (such as `400 Bad Request` and `upgrade expected but low level API in use` errors) for Next.js Hot Module Replacement (`/_next/webpack-hmr`) WebSocket connections.
  - Implemented raw HTTP/1.1 client connection upgrades (`hyper::client::conn::http1::handshake`) for local routing.
  - Formatted upstream upgrade requests with relative path-and-query URIs compatible with HTTP/1.1 origin servers.
  - Rewrote target `Host` and `Origin` headers to bypass Next.js CORS and Host verification rejections.
  - Enabled connection upgrades by calling `.with_upgrades()` on both client-side and server-side connection builders.

## [v1.8.0] - 2026-06-10

### Added

- **Android USB Connection Tab**: Redesigned the Mobile Connection page (`/proxy/mobile`) into a two-tab layout:
  - **Wireless Connect (Wi-Fi / VPN)**: Existing Tailscale VPN and Cloudflare tunnel-based handoff flow.
  - **USB Connect (Android Only)**: New tab for direct USB cable debugging via ADB reverse port forwarding.
- **ADB Auto-Detection**: Backend automatically finds the `adb` binary by scanning:
  - System `PATH`.
  - Standard Android SDK platform-tools locations on Windows (`%LOCALAPPDATA%/Android/Sdk/platform-tools/adb.exe`).
  - macOS paths including Homebrew (`/opt/homebrew/bin/adb`, `/usr/local/bin/adb`).
- **USB Device Status Panel**: The USB tab shows ADB installation status (path, version), lists all connected Android devices by serial number, and provides a one-click Refresh button.
- **ADB Installation Guide**: When ADB is not found, the UI shows platform-specific installation instructions with one-click copy commands (`choco install adb` / `brew install --cask android-platform-tools`).
- **USB Port Tunneling Switch**: A toggle to activate/deactivate `adb reverse tcp:PORT tcp:PORT` for the configured proxy port.
- **Automated Android System Proxy Injection**: Upon activating the USB tunnel, Watchtower automatically injects the system-wide proxy settings directly into connected Android devices via ADB, eliminating manual Wi-Fi proxy configuration:
  - **Enable**: `adb -s <serial> shell settings put global http_proxy 127.0.0.1:PORT`
  - **Disable**: Clears and deletes all global proxy keys on switch off or page exit.
- **iOS Unsupported Warning Card**: Explicit notice in the USB tab explaining why iOS does not support USB reverse tunneling (Apple sandbox limitations), with guidance to use the Wireless tab instead.

### Changed

- **Hardcoded Port Cleanup**: Removed all hardcoded `8888` (proxy) and `13030` (Axum handoff server) values across the codebase:
  - Frontend USB guides now use the live `proxyStatus.port` value dynamically.
  - `landing.html` now uses a `{{AXUM_PORT}}` template placeholder injected by `tunnel_service.rs` at runtime.
- **USB Guide Step 3 Rewritten**: Replaced the manual Wi-Fi proxy configuration instruction with a note that proxy settings are now **automatically injected by Watchtower** and advises users to revert any previously set manual proxy to "None".

### Fixed

- **Tauri App "Not Responding" (응답 없음) on Mobile Page**: Resolved a critical deadlock that caused the application window to freeze when navigating to the Mobile Connection page.
  - **Root cause**: USB Tauri commands (`check_adb_status`, `start_usb_reverse`, `stop_usb_reverse`) were synchronous (`fn`), blocking the main GUI thread. When the ADB daemon was not running, `Command::output()` on `adb devices` would block indefinitely as the spawned background daemon process inherited the piped stdout/stderr file handles.
  - **Fix 1**: Converted all USB Tauri commands to `async fn` to offload execution to Tokio's thread pool.
  - **Fix 2**: Implemented an `ensure_adb_server()` helper that runs `adb start-server` with `Stdio::null()` before any command that pipes output, safely starting the daemon without creating a deadlock.
- **Android "망 접속 안됨" (No Network Access)**: Resolved the issue where the device lost internet access after configuring `127.0.0.1` as a Wi-Fi proxy.
  - **Root cause**: Android OS ignores or blocks loopback addresses (`127.0.0.1`) entered via the Wi-Fi settings UI, rendering the device network-inaccessible.
  - **Fix**: Replaced manual proxy configuration instructions with the automated `adb shell settings put global http_proxy` injection approach, which correctly applies the proxy at the system level and bypasses Android UI restrictions.

## [v1.7.6] - 2026-06-08

### Added

- **Domain Dashboard Copy Button**: Added a copy dropdown to `/domains/dashboard` with two formats:
  - **Domain + Group Name Copy**: Copies domains with their group names in `domain.com (Group A, Group B)` format.
  - **Domains by Group Copy**: Copies domains organized by group sections.
- **API Logs Copy Dropdown**: Replaced single copy button in the log detail modal with a dropdown offering two copy modes:
  - **Copy as HTML**: Copies rich HTML with inline styling, optimized for Azure DevOps ticket comments.
  - **Copy as Markdown**: Copies dual-clipboard (HTML + Markdown plain text), optimized for Microsoft Teams sharing.
- **API Schema Copy Dropdown**: Applied the same copy dropdown policy to `/apis/schema` response cards, positioned in the endpoint header bar alongside History/Send buttons.
- **Promise-based Alert Modal**: Introduced `usePromiseModal` for non-blocking copy confirmation feedback across all copy actions.

### Changed

- **Copy Markdown Format**: Refactored markdown template generation from template literals to `Array.join("\n")` for precise line control, fixing indentation and extra whitespace issues in pasted output.
- **Log Detail Modal Layout**: Restructured the API log detail modal with block-styled headers and JSON pretty-printing for better readability and copy fidelity.

## [v1.7.5] - 2026-06-08

### Added

- **Tauri Specta v2 Integration**: Replaced the manual, error-prone `invokeApi` wrapper and `ApiCommandMap` definitions with automatically generated type-safe TypeScript command bindings.
- **Type Safety and Import Alignment**: Updated all global store atoms (such as `globalSiteCheckAtom`) and route files to utilize the new Specta types, resolving all type incompatibilities.

### Changed

- **Direct Command Binding Calls**: Refactored frontend components to invoke camelCase backend commands directly from `src/bindings.ts` with a unified `unwrap` helper.
- **Opener Plugin Guest Bindings**: Migrated standard tauri-plugin-opener `invoke` calls (`plugin:opener|open` and `plugin:opener|open_url`) in `ux/policies/index.tsx` to use typed official guest bindings (`openPath` and `openUrl`) from `@tauri-apps/plugin-opener`.

### Removed

- **Obsolete API Helpers**: Deleted deprecated helper files (`commands.ts`, `invoke.ts`, and `types.ts` under `src/shared/api`) since the compiler now automatically generates bindings.

## [v1.7.4] - 2026-04-29

### Fixed

- **Mock Rule Registration**: Fixed a critical bug where API mock rules failed to register due to a data structure mismatch between the frontend and backend.
- **Backend Command Refactoring**: Standardized `create_mock_rule` and `update_mock_rule` to use `payload` objects and return consistent `ApiResponse` wrappers.
- **API Type Synchronization**: Updated TypeScript command definitions to perfectly align with the Rust backend's expected input/output structures, ensuring better runtime stability.

## [v1.7.3] - 2026-04-16

### Added

- **Sidebar Status Dot for Inspector**: Added a real-time status indicator to the "UX Policy" and "Inspector" sidebar menus. Users can now instantly see if the inspector/injection engine is active.
- **Improved Sidebar Feedback**: Menu icons now pulse when their respective services (Proxy, Mocking, Inspector) are active, providing better visual feedback.

### Fixed

- **Inspector Setting Persistence**: Resolved an issue where the Inspector's On/Off state was reset after application restart. The state is now correctly persisted in the backend configuration.
- **Service Syncing Logic**: Corrected the synchronization between the `InspectorService` and the `local_proxy` engine to ensure UI toggles are immediately reflected in the traffic interception layer.

## [v1.7.2] - 2026-04-14

### Added

- **Dual View Policy Management**: Introduced a new "Policy List" dashboard with two distinct modes:
  - **Manage Mode**: Interactive cards for easy editing, deleting, and quick access to linked sites.
  - **Report Mode**: A clean, document-style preview optimized for final review and PDF export.
- **Selective Injection Policy**: Enhanced the proxy engine to support selective script injection. Users can now:
  - Toggle injection globally.
  - Define specific domains for injection.
  - If no domains are specified, injection applies globally by default.
- **Report Display Options**: Added toolbar toggles to show/hide specific technical fields (URL, Tag, Selector) in the policy list and PDF report.
- **Dedicated Edit Modal**: Replaced inline editing with a focused modal for updating policy titles and descriptions.

### Changed

- **UX Navigation Overhaul**: Restructured the sidebar to prioritize policy management, separating the high-frequency "Inspector" capture tool from the "Policy List" management dashboard.
- **Improved "Visit Site" Feature**: Enhanced reliability of external URL opening with multi-layer fallbacks (Tauri Opener v2, shell open, and browser window fallback) and expanded security capabilities.

### Fixed

- **WYSIWYG PDF Export**: Completely redesigned the PDF generation logic using style isolation and fixed-width desktop rendering. This resolves layout breaking, missing padding, and "oklch/oklab" color parsing errors in the generated reports.
- **Proxy CORS Interception**: Fixed a bug where API-logged requests were missing critical CORS headers, preventing cross-origin fetches during live interception.

## [v1.7.1] - 2026-04-13

### Fixed

- **Code Quality & Linting**: Resolved multiple Biome linting errors, including unused type definitions (`Position`), shadowed variables (`handleMouseMove`), and missing block statements in `InspectorPanel` and `InjectionApp`.
- **UI Interaction Stability**: Fixed a shadowing issue in the injection engine's mouse move handler that could potentially cause dragging behavior to conflict with inspection logic.

## [v1.7.0] - 2026-04-13

### Added

- **Robust Injection Engine**: Completely overhauled the inspector injection system. It now features aggressive cache-busting, automatic HTTP/3 fallback to HTTP/1.1/2, and a dual-strategy injection (UTF-8 + Byte-level fallback) to ensure the inspector works on any website, regardless of encoding or caching.
- **Policy List Sidebar**: Added a new "📋" panel in the injected app. Users can now view, manage, and delete all policies associated with the current page, even if their visual badges are misplaced due to DOM changes.
- **Heuristic Element Tracking**: Upgraded the selector generator to use IDs and stable semantic attributes (like `data-testid`). The recovery logic now uses a weighted similarity score to re-anchor policies more accurately when page structures change.

### Changed

- **Proxy Pipeline Optimization**: Enhanced the internal proxy to automatically handle Gzip/Brotli decompression for intercepted traffic, enabling reliable content modification without manual encoding management.
- **Cross-Platform Build CI**: Standardized build scripts to be OS-independent, ensuring seamless releases from GitHub Actions runners.

### Fixed

- **MIME Type Enforcement**: Resolved a "text/html" MIME type error for `inspector.js` by strengthening the internal proxy's path interception and adding explicit caching headers for reserved assets.
- **SSL Interception Toggle**: Fixed an issue where the global inspector state wasn't correctly propagated to the SSL decryption layer.

---

## [v1.6.2] - 2026-04-08

### Added

- **Responsive UI Rollout**: Implemented a comprehensive responsive layout down to `720px` (tablet) across Settings, Proxy Dashboard, and Monitoring pages.
- **Persistent Mocking State**: Enhanced the API Mocking experience by persisting selected scenarios, mocking search queries, and the global mocking toggle in local storage across sessions.

### Changed

- **Dynamic Grid Optimization**: Refactored dashboard and monitor grids to use CSS Grid `auto-fill` with `minmax` constraints, ensuring consistent card sizing and graceful wrapping across all resolutions.
- **Virtualized Grid Responsiveness**: Added a `ResizeObserver`-based column calculation to the domain monitor's virtualized list, preserving performance while adapting to container width changes.

### Fixed

- **Dark Mode Audit & Polish**: Resolved broken UI rendering issues in Proxy Setup, Loading screens, and Empty States by replacing hardcoded slate/white colors with semantic theme variables.
- **A11y & Linting**: Resolved sidebar accessibility warnings and fixed missing React hooks and block statement lint errors in monitoring components.

---

## [v1.6.1] - 2026-04-08

### Added

- **Global Proxy Safeguard (`ProxyServerWarning`)**: Created a premium, reusable warning component that indicates when the proxy engine is inactive across all features.
- **Unified Proxy Infrastructure Control**: Relocated the master Proxy Server switch and detailed port settings (Forward/Reverse HTTP/HTTPS) to the global Settings page for centralized infrastructure management.

### Changed

- **Feature-Level Proxy Awareness**: Integrated the `ProxyServerWarning` into Dashboard, Proxy Dashboard, API Logs, API Mocking, and Server Logs.
- **Improved UI Masking**: Functional elements (buttons, lists, filters) in Proxy-dependent pages are now conditionally hidden when the server is OFF to prevent user confusion.
- **Localized Proxy Guidance**: Updated Korean and English dictionaries with clear instructions on how to reactivate the proxy engine directly from the warning component.

### Fixed

- **Proxy Setup Pathing**: Corrected internal navigation links within the Setup Guide to ensure seamless flow between setup and dashboard views.
- **Server Logs Consistency**: Resolved a UI overlapping issue where functional controls were still visible through the proxy warning alert.

---

## [v1.6.0] - 2026-04-08

### Added

- **Unified StatusToggle Component**: Introduced a premium, high-feedback toggle component (`StatusToggle`) to standardize feature activation across all dashboards.
- **Interactive Home Dashboard**: Transformed passive status badges on the home screen into active toggles. Users can now control **Mocking** and **Proxy Active** (Local Routing) directly from the header.
- **Advanced Proxy Controls**: Integrated full Start/Stop server controls into the Proxy Dashboard using the new unified toggle UI, replacing legacy buttons and static badges.

### Changed

- **UI/UX Consistency**: Synchronized the design language for feature toggles (Mocking, Proxy, Local Routing) across the entire application for a more cohesive, high-end experience.
- **Real-time Feedback**: Added integrated loading states to all major feature toggles, providing immediate visual confirmation during asynchronous backend operations.

### Fixed

- **Dashboard Accessibility**: Resolved multiple WCAG compliance issues by properly associating form labels with their respective inputs using unique IDs.
- **API Scoping Precision**: Enhanced Mock Rule logic to include optional `Host (Origin)` filtering, allowing for domain-specific mocking behavior.

---

## [v1.5.2] - 2026-04-03

### Changed

- **Unified Multi-Group Management**: Refactored Monitoring and API Setting dashboards to display domains independently under each assigned group section, removing legacy comma-separated headers.
- **Synchronized Selection Tracking**: Implemented ID-based unified selection logic. Checking a domain in one group section now automatically updates all of its other occurrences across the dashboard.
- **Refined Registration Workflow**: Removed automatic navigation and background monitoring sync upon new domain registration, allowing for a more controlled setup process.

### Fixed

- **Registration Group Matching**: Resolved a bug where domains could be assigned to incorrect groups during bulk registration due to UI state desynchronization.
- **Search Scope Expansion**: Enhanced dashboard search to include both domain URLs and group names for more comprehensive results.

---

## [v1.5.1] - 2026-04-03

### Added

- **Enhanced Domain Group Management**: Redesigned the "Assign Domains" modal with a search bar, group-based filtering, and cross-group membership visibility (badges showing other assigned groups).
- **Smart Home Dashboard Stats**: Integrated real-time API request counting for the "Today" stats on the home dashboard, replacing previous static/incorrect counts.

### Changed

- **UI Refinement (Border Radius)**: Optimized the global modal border radius from `2.5rem` to `3xl` (24px) for a sharper, more professional look, along with internal element radius adjustments.
- **Flattened Monitoring Groups**: Domains belonging to multiple groups are now displayed in each group's section independently, rather than creating a combined group header.
- **Empty State Modernization**: Overhauled all "Empty State" visuals across Domain and Monitor dashboards with theme-aware dashed borders and glowing icon effects.

### Fixed

- **Modal Context Stability**: Resolved a critical "Modal provider" error that caused the application to crash when opening certain domain management modals.
- **Z-Index Collisions**: Fixed minor layering issues where the sidebar glow effect could overlap with open modals.

---

## [v1.5.0] - 2026-04-03

### Added

- **Dynamic Theme Personalization**: Linked the app's `primary-color` to the user's selected avatar theme. The entire UI color scheme (Sidebar highlights, buttons, loading bars, icons) now updates in real-time based on the user's profile choice.
- **Theme-Aware Confirmation System**: Replaced native browser alerts with a premium, theme-consistent `ConfirmModal` for sensitive actions like API and domain deletion.

### Changed

- **UI Modernization (DaisyUI v4)**: Fully transitioned all hardcoded slate/white styles to semantic DaisyUI variables throughout the Monitoring, API Schema, and Proxy dashboards.
- **Dashboard Aesthetic**: Standardized all dashboard cards with `rounded-[2rem]` or `rounded-[3rem]` and enhanced typography (`font-black`) for a more modern, premium feel.
- **API Schema UX**: Redesigned the "Empty State" for the API Schema explorer with better instructions and a theme-consistent visual call-to-action.

### Fixed

- **Server Logs Visibility**: Resolved contrast issues in the Log Viewer where timestamps and labels were illegible in Light Mode. Applied a theme-independent high-contrast terminal styling.
- **Sidebar Icon Matching**: Synchronized Sidebar icon colors and hover states with the dynamic primary theme to fix visual imbalance.
- **Monitor Grouping Constraints**: Fixed a layout bug where `overflow-scroll` was clipping card borders and shadows in grouped monitoring views.

---

## [v1.4.10] - 2026-04-02

### Added

- **Isolated Window Persistence**: Introduced `atomWithWindowStorage`, a new persistence strategy that isolates UI state by window label. This allows multiple API windows to have their own independent selection and search history while maintaining data in `localStorage`.
- **Inherited Initial Context**: Detached windows now automatically clone the current state of the "main" window upon opening, providing immediate context that can then diverge independently.

### Changed

- **API Context Isolation**: Switched `/apis/schema` and `/apis/logs` to use isolated persistence. This allows users to open multiple documentation and log viewers for different domains simultaneously without synchronization conflicts.

### Fixed

- **Rust Build Compatibility**: Resolved compilation errors on Darwin (macOS) targets related to `WebviewWindowBuilder::transparent` and type inference in `window_commands.rs`.
- **Rust Code Quality**: Cleaned up various `unused_mut`, `unused_imports`, and `dead_code` warnings in `local_proxy.rs` to ensure a completely clean build.

---

## [v1.4.9] - 2026-04-02

### Added

- **Multi-Window State Synchronization**: Refined `atomWithBroadcast` with remote update locking and value equality checks to eliminate infinite render loops across detached windows.
- **Universal Detach Support**: Added a generic "Detach" button to the titlebar, allowing any page (including the root Dashboard) to be pulled into a standalone window.
- **Security Capability Expansion**: Updated Tauri's capability configuration to grant all detached windows (`*` label) permission to listen to backend events and invoke APIs.
- **Context-Aware Sync Strategy**:
  - **Global Data Broadcast**: Synchronizes true backend data (domains, proxy routes, logs) across all windows in real-time.
  - **Local View Persistence**: Isolated UI-only states (search queries, filters, scroll positions) per window to prevent "ghost typing" while inheriting initial state via `atomWithStorage`.

### Changed

- **Server Logs UI**: Cleaned up duplicated search inputs and improved the header layout for better space efficiency.
- **Window Lifecycle**: Refined sub-window management to ensure all detached windows close gracefully when the main application window is exited.

---

## [v1.4.8] - 2026-03-31

### Added

- **Server Logs Dashboard**: Implemented a high-performance terminal-style log viewer for real-time Rust backend and proxy traffic monitoring.
- **Log Level Filtering**: Added a multi-level filter (DEBUG, INFO, WARN, ERROR) to the server logs to isolate specific events.
- **Advanced Log Detail View**: Integrated a detailed modal view for logs with support for:
  - **DNS Record Parsing**: Specialized visualization for DNS response dumps (Hickory Resolver) with color-coded records (CNAME, A, etc.).
  - **Pattern Highlighting**: Automatic syntax highlighting for IP addresses, HTTP methods, and status codes.
- **Log Control**: Added Pause/Resume functionality to stabilize the view during high-traffic periods and a 10,000-line virtualized scroll buffer.

### Fixed

- **TanStack Router Warnings**: Optimized route tree scanning by configuring `routeFileIgnorePattern` for non-route internal files (`en.ts`, `ko.ts`, `store.ts`).

---

## [v1.4.7] - 2026-03-30

### Added

- **Domain Dashboard Functional Hub**: Transformed the domain list into a centralized hub for managing monitoring, proxying, and API logging in-place.
- **In-line Feature Toggling**: Users can now toggle Monitoring, Proxy Local Routing, and API Logging status directly on each domain card without navigating away.
- **Direct Proxy Route Addition**: Integrated a mini-modal to add local proxy routes from the domain list, eliminating the need to visit the proxy dashboard for basic setup.
- **Proxy Status Context**: Added real-time global proxy status awareness and guidance (e.g., toast banners) when trying to manage routes while the proxy is stopped.

### Changed

- **Domain Row UI**: Redesigned domain rows to accommodate feature badges while maintaining a clean, premium aesthetic with improved spacing and animations.
- **Modal UX**: Rewrote proxy route modals to use Portals for better stacking in virtualized lists and improved field alignment for a more professional feel.

---

## [v1.4.6] - 2026-03-30

### Added

- **Persistent Page State Management**: Implemented route-level Jotai stores for all major pages to maintain UI state (search queries, filters, input fields) across navigation.
- **API Schema Persistence**: Enhanced the API schema explorer to remember selected domains, endpoints, and individual form data per endpoint, surviving app restarts via `atomWithStorage`.
- **Expanded Filter Persistence**: Migrated monitor and API logs to use `atomWithStorage` for filter settings, ensuring selections persist across app reloads.
- **Proxy Dashboard Memory**: Port settings and route addition inputs now persist across page changes.

### Changed

- **State Architecture**: Refactored application state to a modular "route-level store" pattern for better maintainability and performance.

---

## [v1.4.5] - 2026-03-27

### Added

- **User Profile System**: Integrated a persistent user profile system using Jotai (`atomWithStorage`). Users can now customize their name, role, and avatar theme (gradients).
- **Onboarding Flow**: Added a premium first-time onboarding modal that greets new users and guides them through account setup and language selection.
- **Standalone Profile Page**: Created a dedicated `/profile` route for managing personal information and language preferences, providing a focused space for user customization.

### Changed

- **Sidebar Redesign**:
  - Removed the top logo section for a minimalist, sophisticated aesthetic.
  - Replaced hardcoded profile data with dynamic atom-based data.
  - Decoupled Profile Settings and General Settings click targets to prevent overlapping event issues.
- **Settings Refinement**: Migrated language preferences from global settings to the Profile page.

### Fixed

- **A11y (Accessibility)**: Resolved multiple labeling inconsistencies and ensured all inputs on the onboarding and profile pages are correctly associated for screen-reader support.

---

## [v1.4.4] - 2026-03-27

### Changed

- **Routing Structure**: Migrated file-based routes (`*.tsx`) across `apis`, `domains`, `monitor`, and `proxy` to a folder-based structure (`*/index.tsx`) for better code organization and collocation of localization files.
- **Localization (i18n)**: Fully decoupled hardcoded UI text in domain feature components (`DomainListEmpty`, `EditDomainModal`, `GroupSelectModal`, `GroupCard`, etc.) by passing translation dictionaries via props. Refined Korean dictionaries for a more natural UX.

### Fixed

- **Logs UI Layout**: Fixed an issue where grid and flex layouts were completely broken on `/monitor/logs` and `/apis/logs`. The root cause was an overly broad `logs` entry in `.gitignore` that caused Tailwind v4 to abruptly skip scanning any directory named `logs` for utility classes.

---

## [v1.4.3] - 2026-03-26

### Fixed

- **Proxy Infinite Loop**: Fixed an issue where the `reqwest` client would pick up the OS system proxy (Watchtower itself), causing an infinite request loop. Added `.no_proxy()` to bypass system settings.
- **Local Route Streaming**: Fixed a bug where local route requests were fully buffered into memory when API logging was disabled. Now uses a fast streaming body path to support SSE and chunked streams properly.
- **Root Path 404 Error**: Fixed the Axum router configuration to correctly match the root `/` path. Previously, the `/*path` rule failed to match `/`, leading to unexpected 404 errors.
- **GET Request Body Error**: Fixed a bug where `GET`, `HEAD`, and `OPTIONS` requests were assigned an empty body stream, causing `reqwest` to append a `Transfer-Encoding: chunked` header which was rejected by Next.js/Node servers.
- **Garbled Text Rendering**: Fixed an issue where compressed responses (like `gzip` or `br`) appeared as garbled text in the browser. The proxy now preserves the `content-encoding` header, allowing the browser to decode it correctly.

---

## [v1.4.2] - 2026-02-27

### Added

- **Docs**: Aligned architecture design with the new 9-step development roadmap.
  - Defined new data models: SubPage, TestScenario, ScenarioStep, and MockRule.
  - Detailed the API Chaining pipeline (variable extraction & template substitution).
  - Integrated Golden Master (Mocking) interceptor logic into the Proxy architecture.
  - Specified the Sequential Migration (Migration Chain: v1->v2->v3) strategy.

### Changed

- **Monitoring**: Expanded monitoring scope to include per-route health checks for sub-pages.
- **Architecture Models**: Updated project overview diagrams and unified backend command specifications.
- **UI**: Updated icons across the application.

---

## [v1.4.1] - 2026-02-20

### Added

- **API Logs System** (`/apis/logs`): Full implementation of request/response logging (Phase 2).
  - Daily JSONL log rotation with file management.
  - Logs Dashboard with filtering by Date, Method, Host, and Path.
  - Detail view for request/response headers and bodies.
- **API History & Replay**: Schema Viewer now has a "History" button to view log entries for the selected endpoint.
- **Request Replay**: One-click to populate request headers and body from historical logs into the Schema test form.
- **API Log Filter**: `get_api_logs` backend command extended with `exact_match` filter support for precise endpoint lookup.

### Changed

- **Schema UI**: Improved Domain Selector design (Card-based) and overall Schema Viewer layout responsiveness.
- **UI Refinement**: Fixed button shrinking and text wrapping issues on mobile layouts across Dashboard and Logs pages.
- **Code Quality**: Fixed `ApiLogEntry` property naming (snake_case) consistency between frontend and backend.
- **Icons**: Added missing Lucide icons (`Clock`, `X`) to Schema Viewer.

---

## [v1.4.0] - 2026-02-13

### Added

- **APIs section**: New sidebar section "APIs" with Dashboard, Settings, Schema, and Logs (Logs placeholder).
- **APIs Dashboard**: Per-domain API logging—register domains, toggle logging/body, set Schema URL, download OpenAPI schema from URL. Cascade delete of API logging links when a domain is removed.
- **APIs Settings** (`/apis/settings`): Two-panel UI for domain registration/unregistration with group-based sections and search (same pattern as Monitor Settings).
- **API Schema viewer** (`/apis/schema`): OpenAPI 3.x JSON viewer—select domain, browse tag-grouped endpoints, fill parameters/body, send request (Try-it-out), view response. Custom headers collapsible; compact parameter layout.
- **Schema URL & download**: `DomainApiLoggingLink` now has `schemaUrl`; backend commands `download_api_schema` and `get_api_schema_content` for fetching and storing schemas under `{app_data}/schemas/{domain_id}.json`.
- **Send API request**: Backend `send_api_request` command (reqwest, TLS skip, 30s timeout) returns status, headers, body, elapsed time; errors returned as ApiResponse for clear UI feedback.
- **OpenAPI parser**: Frontend `openapi-parser.ts` for endpoint extraction, `$ref`/`allOf` resolution, and example JSON generation.
- **Version bump scripts**: `pnpm version:patch`, `version:minor`, `version:major` to sync version across `package.json`, `tauri.conf.json`, and `Cargo.toml`.

### Changed

- **Proxy always-on**: Proxy auto-starts on app launch; start/stop buttons removed. "Local routing" toggle controls whether traffic is routed to local backends or passed through; port settings (forward + reverse) consolidated in one card.
- **Proxy auto-start errors**: Persistent error state and banner when proxy fails to start (e.g. port in use); manual retry via dashboard.
- **Monitor rename**: "Status" renamed to "Monitor"—routes `/status` → `/monitor`, "Status Check Settings" → "Monitor Settings", "Live Status" → "Live Monitor". Backend `DomainStatus` → `DomainMonitorLink`, `domain_status.json` → `domain_monitor_links.json` with migration.
- **Monitor Settings**: Group-based collapsible UI and search (URL or group name); fixed scroll-to-top bug on checkbox click by moving ListItem out of parent component.
- **Docs**: `docs/plans/` restructured to `docs/architecture/`; added `docs/TODO.md` for implementation checklist. New/updated docs: 05-monitor (group UI), 07-apis (Dashboard, Settings, Schema viewer), 09-domain-use-cases, 10-json-schema-migration.

### Fixed

- **HTTPS CONNECT**: Fixed request body stream blocking in `forward_to_backend` (reconstruct request for GET/HEAD/etc. to avoid blocking on TLS-terminated body).
- **PAC file**: Forward proxy now passes its port to `ProxyState` so `/.watchtower/proxy.pac` is generated correctly.
- **Certificate download**: Setup page certificate download now uses HTTP proxy port (`http://127.0.0.1:{port}/.watchtower/cert/...`) instead of HTTPS target URL, avoiding chicken-and-egg trust issue.
- **Schema viewer base URL**: Domain URL already containing scheme (e.g. `https://api.example.com`) no longer double-prefixed as `https://https//...`.

---

## [v1.3.2] - 2026-02-12

### Added

- **Search domains in proxy**: Added search domains support in proxy feature.
- **Version display**: App version is now shown on the Home page hero section (from `tauri.conf.json`).
- **Docs consolidation**: Project docs moved from `.agent/workflows` to `docs/` (Human·Agent shared). Added `.agent/README.md` and `.cursor/README.md` as pointers.
- **YAML frontmatter**: All docs now have consistent frontmatter (`title`, `description`, `keywords`, `when`, `related`). Keywords unified in Korean.

### Changed

- **Route restructure**: Split dashboards (`/domains/dashboard`, `/proxy/dashboard`), reorganized status routes (`/status` with index, logs, settings).
- **Docs structure**: Standardized `related` path format; updated docs/README with document map and directory structure.

---

## [v1.3.1] - 2026-02-11

### Fixed

- **Pubkey alignment**: Fixed updater public key to match the signing key used in CI. In-app update install and verification now work correctly (resolves "signature was created with a different key" error).

---

## [v1.3.0] - 2026-02-11

### Added

- **Auto-update notifications**: App checks for updates on startup (3s delay) and shows a notification banner when a new version is available.
- **Settings page**: "Check for updates" button for manual check.
- **Signed updates**: Tauri updater plugin with GitHub Releases; requires signing keys. See "Updater Setup" in README.

---

## [v1.2.1] - 2026-02-11

### Added

- **In-app setup page** (`/proxy/setup`): PAC URL, manual proxy, and HTTPS certificate download. "Open Setup Page" button now navigates in-app instead of opening in browser.
- **Host-specific certificate**: Shared `HostCertCache` so TLS and download serve the same cert—installing the downloaded cert now correctly trusts the server. Fixed CN (hostname) and validity dates (no more 1975 issue).
- **Setup page in English**: Both in-app and proxy-served setup pages localized to English.
- **Window startup**: App starts maximized (`maximized: true` in `tauri.conf.json`).

### Changed

- **Setup HTML extraction**: Proxy setup page moved from inline Rust to `src-tauri/resources/setup.html` for easier maintenance.

### Removed

- **Standalone setup app**: `apps/setup` Vite project removed (consolidated into main app).

---

## [v1.2.0] - 2026-02-10

### Added

- **Settings page** (sidebar entry): DNS server (used for proxy pass-through and domain status checks), full settings Export/Import (JSON: domains, groups, links, proxy routes, DNS).
- **Proxy**: Optional DNS server for pass-through; when no route matches, hostnames are resolved via the configured DNS. Domain status checks also use the same global DNS.
- **Domain management**: Domain settings (pencil icon) opens Edit modal: change address (URL) and group in one place.
- **Status Logs**: Level filter (All / Info / Warning / Error) to narrow log list.
- **App identity**: Watchtower tower icon (SVG) applied to sidebar, titlebar, favicon, and window/taskbar.

### Changed

- **UI consistency**: Input, Button (incl. `size="icon"`), Textarea, Badge style unified across pages; raw inputs replaced with shared components where applicable.
- **API**: `update_domain_by_id` now takes optional payload `{ url? }`.

---

## [v1.1.0] - 2026-02-10

### Added

- Row virtualizer on Domains list page for smooth scrolling with large lists.
- Row virtualizer on Status page (per-group) with card grid virtualization.
- Row spacing between virtualized rows on domains and status pages.

### Changed

- **Refactored UI** into feature modules: `features/dashboard`, `features/domains-list`, `features/domain-groups`, `features/domain-status`.
- Extracted reusable components: HeroSection, FeatureGrid, SystemStatusCard, VirtualizedDomainList, DomainRow, GroupSelectModal, DomainListEmpty, CreateGroupCard, GroupCard, AssignDomainsModal, VirtualizedGroupSection.

---

## [v1.0.0] - 2026-02-09

### Added

- **Initial Stable Release** 🚀
- Global Loading Screen with interactive cancel functionality.
- Full History Logs system with daily file rotation.
- Dashboard Hero design and responsive layout.
- Husky + lint-staged for development workflow.
- Unified domain management and real-time status UI.
