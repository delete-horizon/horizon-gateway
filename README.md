English | [한국어](README.ko.md)
<div align="center">

<img src="./public/logo-animated.svg" alt="Horizon Gateway Logo" width="100%" />

# Horizon Gateway

Free local MITM, API mock, and domain health in one desktop app.  
Personal and commercial use. Your AI agent can drive it with `hgc`.

<p align="center">
  <a href="https://github.com/delete-horizon/horizon-gateway/releases"><strong>Download</strong></a> ·
  <a href="https://gateway.delete-horizon.com"><strong>Website</strong></a> ·
  <a href="./README.ko.md"><strong>한국어 문서 (Korean)</strong></a>
</p>

[![Release](https://img.shields.io/github/v/release/delete-horizon/horizon-gateway?style=flat-square&color=blue)](https://github.com/delete-horizon/horizon-gateway/releases)
[![License](https://img.shields.io/badge/license-Free%20for%20Personal%20%26%20Commercial%20Use-green?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#installation)
[![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202%20%2B%20React%2019-orange?style=flat-square)](https://tauri.app)

</div>

---

<div align="center">
  <img src="./docs/images/gateway-proxy-routes.png" alt="Horizon Gateway Proxy Connections" width="90%" />
</div>

---

## What it does

Horizon Gateway is a desktop app for local HTTPS inspection, API mocks, and domain checks.

- HTTPS proxy built with Hyper and Tokio. It serves a PAC file, and a TLS bypass list can skip decryption for hosts you choose.
- Map one hostname, such as `api.example.dev`, to a local target such as `localhost:3000`. Matching is the exact hostname. This does not edit the hosts file.
- Mock rules set a status code, response headers, a body, and a delay. The proxy waits that long before the mock response. A delay above 30 seconds is capped at 30 seconds.
- A rule on the built-in Default scenario applies while that rule is enabled. A rule on another scenario applies only while that scenario is enabled. When both match, the enabled scenario's rule is used.
- OpenAPI: download a spec for a domain and browse or try its endpoints.
- Domain monitor: HTTP status and latency for registered domains. Domains can be grouped.
- UI/UX Guides (Tools → UI/UX Guides): edit guides, import and export JSON, and write a PDF report.
- `hgc` talks to the same proxy, mock, and domain data from a terminal.

## Experimental

This is in the app, and it is not finished:

- **Transparent proxy** (Windows only): Settings calls this experimental. It uses WinDivert, needs an elevated backend, and needs the local proxy running.

## Other devices

**Allow other devices** (Settings → Proxy) is off by default. While it is off, the proxy listens on `127.0.0.1`. Turn it on to let other devices on the local network use the proxy and the setup page. Restart the app after you change it.

---

## Screenshots

<div align="center">
  <p><strong>API Mocking: Edit Rule</strong></p>
  <img src="./docs/images/gateway-mock-editor.png" alt="API Mocking Edit Rule dialog" width="85%" />
  <br/><br/>
  <p><strong>hgc CLI</strong></p>
  <img src="./docs/images/gateway-hgc-cursor.png" alt="hgc init and get_domains in a terminal" width="85%" />
</div>

---

## Devices

- **Android (ADB)**: with the proxy running and a device in USB debugging, the app can forward the proxy port over USB.
- **iOS USB**: not supported.
- **Wireless**: if Tailscale is running, the app can show its address. If `cloudflared` is installed, the app can start a temporary Cloudflare tunnel for the first mobile connection.

---

## Installation

Download installers from [GitHub Releases](https://github.com/delete-horizon/horizon-gateway/releases). The [v2.8.15](https://github.com/delete-horizon/horizon-gateway/releases/tag/v2.8.15) assets are:

| Operating System | Package | Architecture | Size |
|---|---|---|---|
| Windows | NSIS `.exe` (`horizon-gateway_2.8.15_x64-setup.exe`). There is no `.msi`. | x64 | 22.9 MB |
| macOS | `.dmg`, one file for Apple Silicon and one for Intel | aarch64, x64 | 30.5 MB, 31.7 MB |
| Linux | `.deb` | x64 (amd64) | 33.7 MB |
| Linux | `.rpm` | x64 | 33.7 MB |
| Linux | `.AppImage` | x64 (amd64) | 110.8 MB |

Sizes are decimal megabytes of those release files. The same release also has updater files (`.sig`, `latest.json`, `.app.tar.gz`) and `SHA256SUMS` for the installers and updater binaries. Later releases can differ in size. See [Verifying downloads](#verifying-downloads).

---

## Verifying downloads

`SHA256SUMS` is attached starting with the first release after [v2.8.15](https://github.com/delete-horizon/horizon-gateway/releases/tag/v2.8.15). v2.8.15 and earlier releases do not include it.

`SHA256SUMS` lists SHA-256 hashes for the installer and updater binaries (`.exe`, `.dmg`, `.deb`, `.rpm`, `.AppImage`, `.app.tar.gz`) and, when the release attaches it, `horizon-gateway.mcpb`. The `.sig` files are minisign signatures for the in-app updater, and `latest.json` is the updater manifest. Those two are left out of `SHA256SUMS`. Each line is `<hash>  <filename>` (two spaces), sorted by filename.

Download `SHA256SUMS` into the same folder as the package you want to check.

Linux:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

`--ignore-missing` checks the files in that folder and skips names you did not download.

macOS uses the built-in `shasum` and checks only the file you downloaded. Replace `<version>` with the release version, without a leading `v`. The space before the filename matches the two-space line. Apple Silicon:

```bash
grep ' horizon-gateway_<version>_aarch64.dmg$' SHA256SUMS | shasum -a 256 -c -
```

For Intel, use `horizon-gateway_<version>_x64.dmg` in the same command.

Windows PowerShell:

```powershell
Get-Content SHA256SUMS | ForEach-Object {
  $expected, $name = $_ -split '\s+', 2
  if (-not (Test-Path -LiteralPath $name)) { return }
  $actual = (Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash.ToLower()
  if ($actual -eq $expected.ToLower()) { "OK: $name" } else { throw "SHA256 mismatch: $name" }
}
```

---

## Quick Start

1. **Start the Proxy**: Open **Settings** from the top bar. On the **Proxy** tab, turn on **Proxy**.
2. **Install Root CA**: Open **Settings → Proxy → HTTPS certificate (Root CA)** and click **Save certificate** so the OS or browser can trust HTTPS decryption.
3. **Add a route**: Under **Tools → Proxy Connections**, map a domain (for example `api.example.dev`) to a local target such as `localhost:3000`.
4. **Mock an API**: Under **Tools → API Mocking**, add a rule for a path (for example `/api/users`) with a status code and JSON body.

---

## AI Agent Integration

`hgc` is a separate console program. It does not request administrator rights. `hgc init --project` writes this skill to `.agents/skills/horizon-gateway` and links it into `.claude/skills/horizon-gateway` and `.windsurf/skills/horizon-gateway`. Cursor, Codex, Gemini CLI, and Copilot read the `.agents/skills` copy. The same command adds a read-only MCP server entry for Cursor, Claude Code, and Gemini CLI. The server is `hgc mcp` on stdio.

```bash
# Initialize the skill and read-only MCP configs in the current project
hgc init --project

# List all available internal commands
hgc list

# Inspect command usage and schemas
hgc help get_domains

# Execute a command directly
hgc run get_domains '{}'

# MCP server for an agent (stdio). Read-only unless flagged.
hgc mcp
hgc mcp --allow-write
hgc mcp --allow-body
```

### MCP

`hgc mcp` speaks MCP `2026-07-28` on stdio and calls the local core through the same control socket and token as the CLI. `hgc init --project` writes a read-only entry (`"args": ["mcp"]`) into `.cursor/mcp.json`, `.mcp.json`, and `.gemini/settings.json`. If a `horizon-gateway` entry is already there, that entry is left as it is.

With no flags, these read-only tools are available: `get_status`, `list_routes`, `list_mocks`, `list_domains`, `list_traffic`, `get_config`. `list_traffic` returns id, method, host, path, status code, size, and capture time. Query values in the path are replaced with `REDACTED`. Headers and bodies are not returned.

`--allow-body` and `--allow-write` are off by default. Pass the flag, or set `allowBody` or `allowWrite` to true in `hgc-mcp.json` in the app data directory. A flag only turns its switch on.

`--allow-body` adds `get_traffic_body`. One call returns one body, request or response, for one log id, up to 4 KB, and marks it `UNTRUSTED CONTENT`. It is off by default because a response body from an arbitrary site can carry prompt injection.

`--allow-write` adds `create_mock`, `update_mock`, `delete_mock`, `create_route`, `update_route`, `delete_route`, `start_proxy`, and `stop_proxy`. It is off by default because those tools change the user's proxy, mocks, and routes.

PAC, remote access, tokens, certificate install, proxy settings updates, and the Cloudflare tunnel are never exposed, under any flag.

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "horizon-gateway": {
      "command": "hgc",
      "args": ["mcp"]
    }
  }
}
```

Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "horizon-gateway": {
      "command": "hgc",
      "args": ["mcp"]
    }
  }
}
```

Gemini CLI (`.gemini/settings.json`):

```json
{
  "mcpServers": {
    "horizon-gateway": {
      "command": "hgc",
      "args": ["mcp"]
    }
  }
}
```

Add `"--allow-write"` or `"--allow-body"` to `args` only for an agent that should change the proxy or read a captured body. `server.json` is the MCP Registry document for `io.github.delete-horizon/horizon-gateway`. Releases attach one `horizon-gateway.mcpb` for Windows x64 and Linux x64; it runs `hgc mcp` and the free desktop app must be running. macOS is not in that bundle. Use the `hgc` that ships inside the app. See [docs/mcp-registry.md](./docs/mcp-registry.md).

`hgc mcp` always uses the local control socket and the local token. It does not use remote attach.

### Remote attach

Remote attach is off unless the daemon is started with `--remote-attach`, `HG_SERVE_REMOTE_ATTACH=1`, or `remote-attach.json`. Bind it to the Tailscale IP with `--remote-bind`, `HG_SERVE_REMOTE_BIND`, or the `bind` field in `remote-attach.json`. If that address is omitted, the socket falls back to `0.0.0.0` and the daemon logs a warning. Remote clients must use TLS with the self-signed certificate created on first enable. Pin the SHA-256 fingerprint with `--tls-fingerprint` or `HG_SERVE_TLS_FINGERPRINT`. Without a pin, `hgc` stores the first fingerprint it sees. Send the remote token only after the handshake (`--remote-token-file`, `--remote-token`, or `HG_SERVE_REMOTE_TOKEN`). The default scope is read-only plus mock and route edits. `HG_SERVE_REMOTE_SCOPE=admin` (or `full`) is required for proxy start/stop, PAC set/clear, `allow_remote_access`, and token reissue. `reissue_remote_token` invalidates the previous token and live remote sessions immediately; the new token is only in `serve.remote.token` on the host.

```bash
horizon-gateway-serve --remote-attach --remote-bind 100.64.0.2
hgc --attach 100.64.0.2:17345 --remote-token-file ./remote.token --tls-fingerprint <sha256> get_proxy_status '{}'
```

---

## Tech Stack

- **Desktop Shell**: Tauri 2, Rust, Tokio, Hyper, Axum
- **Frontend UI**: React 19, Vite 7, TanStack Router, Jotai, Tailwind CSS 4, DaisyUI 5
- **Tooling**: TypeScript 5.8, Biome, pnpm

---

## License & Notice

- **Free for Personal and Commercial Use**: Core desktop features and CLI are completely free to use. Source code is not open; download the official installer.
- **Author**: 규연 (kyuyeon)
- **Contact**: `hello@delete-horizon.com`
- **Changelog**: See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.
