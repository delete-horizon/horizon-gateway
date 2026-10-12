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
- Mock rules set a status code, response headers, and a body.
- OpenAPI: download a spec for a domain and browse or try its endpoints.
- Domain monitor: HTTP status and latency for registered domains. Domains can be grouped.
- UI/UX Guides (Tools → UI/UX Guides): edit guides, import and export JSON, and write a PDF report.
- `hgc` talks to the same proxy, mock, and domain data from a terminal.

## Experimental

These are in the app, and they are not finished:

- **Transparent proxy** (Windows only): Settings calls this experimental. It uses WinDivert, needs an elevated backend, and needs the local proxy running.
- **Mock scenarios**: rules are stored on a scenario, but the proxy applies enabled rules and does not check which scenario is active.

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

Sizes are decimal megabytes of those release files. The same release also has updater files (`.sig`, `latest.json`, `.app.tar.gz`). Later releases can differ in size.

---

## Quick Start

1. **Start the Proxy**: Launch Horizon Gateway and toggle the local proxy switch in the sidebar.
2. **Install Root CA**: Open **Settings → Proxy → HTTPS certificate (Root CA)** and click **Save certificate** so the OS or browser can trust HTTPS decryption.
3. **Add a route**: Under **Tools → Proxy Connections**, map a domain (for example `api.example.dev`) to a local target such as `localhost:3000`.
4. **Mock an API**: Under **Tools → API Mocking**, add a rule for a path (for example `/api/users`) with a status code and JSON body.

---

## AI Agent Integration

`hgc` is a separate console program. It does not request administrator rights. `hgc init --project` writes a skill to `.agents/skills/horizon-gateway` in the current directory. Agent targets are cursor, claude, codex, gemini, copilot, and windsurf.

```bash
# Initialize AI agent skills in the current project
hgc init --project

# List all available internal commands
hgc list

# Inspect command usage and schemas
hgc help get_domains

# Execute a command directly
hgc run get_domains '{}'
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
