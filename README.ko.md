[English](README.md) | 한국어

<div align="center">

<img src="./public/logo-animated.svg" alt="Horizon Gateway Logo" width="100%" />

# Horizon Gateway

로컬 MITM 프록시, API 목, 도메인 상태 확인을 데스크톱 앱 하나에 넣었습니다.  
설치 프로그램의 기본 기능은 개인용·상업용 모두 무료입니다. 터미널에서는 `hgc`로 같은 기능을 조작합니다.

<p align="center">
  <a href="https://github.com/delete-horizon/horizon-gateway/releases"><strong>다운로드</strong></a> ·
  <a href="https://gateway.delete-horizon.com/ko"><strong>웹사이트</strong></a> ·
  <a href="./docs/ko/getting-started.md"><strong>시작 가이드</strong></a> ·
  <a href="./README.md"><strong>English</strong></a>
</p>

[![Release](https://img.shields.io/github/v/release/delete-horizon/horizon-gateway?style=flat-square&color=blue)](https://github.com/delete-horizon/horizon-gateway/releases)
[![License](https://img.shields.io/badge/license-개인·상업%20사용%20무료-green?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#설치)
[![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202%20%2B%20React%2019-orange?style=flat-square)](https://tauri.app)

</div>

---

<div align="center">
  <img src="./docs/images/gateway-proxy-routes.png" alt="Horizon Gateway 프록시 연결 맵" width="90%" />
</div>

---

## 어떤 앱인가요

프론트를 먼저 붙일 때 백엔드 JSON이 아직 없거나, 스테이징 호스트를 내 머신의 `localhost:3000`으로 돌려야 할 때 쓰는 로컬 도구입니다. 브라우저가 프록시를 타면 HTTPS를 호스트마다 열어 보고, 규칙에 맞는 요청에는 지정한 상태 코드와 본문을 대신 내려줍니다. 등록한 도메인은 살아 있는지도 함께 봅니다.

이 자리는 보통 Charles·Proxyman, Mockoon·Postman, ngrok·Cloudflare Tunnel, 브라우저 개발자 도구와 정리용 문서가 나눠 갖습니다. Horizon Gateway는 그 로컬 작업을 Tauri 2 앱과 콘솔 `hgc`로 모읍니다.

---

## 화면

<div align="center">
  <p><strong>API 모킹 — 룰 수정</strong></p>
  <img src="./docs/images/gateway-mock-editor.png" alt="API 모킹 룰 수정 대화상자" width="85%" />
  <br/><br/>
  <p><strong>hgc CLI</strong></p>
  <img src="./docs/images/gateway-hgc-cursor.png" alt="터미널에서 hgc init과 get_domains를 실행한 화면" width="85%" />
</div>

---

## 주요 기능

### 로컬 프록시와 호스트 라우트

브라우저 HTTPS를 이 PC에서 보고, 고른 호스트만 로컬 개발 서버로 보냅니다.

Hyper·Tokio로 동작하고, 기본 포트는 8888입니다. 프록시를 켜면 아래 PAC 주소가 생기니 시스템이나 브라우저 자동 구성에 넣습니다. 수동으로 쓸 때는 `127.0.0.1`과 포워드 프록시 포트입니다.

`http://127.0.0.1:<포트>/.horizon-gateway/proxy.pac`

HTTPS 본문을 보려면 그 도메인에서 **HTTPS 복호화**를 켭니다. 목록에 없는 호스트는 터널로 지나갑니다. **TLS 우회 시드**에 있는 호스트는 복호화보다 우선하며, 처음에는 Teams, Slack, Zoom, Discord, Microsoft·Google·Apple·Okta·Auth0 로그인, 캡티브 포털 확인 주소가 들어 있습니다. 한 줄에 호스트 하나로 고칩니다. 복호화에는 Root CA(`horizon-gateway-root-ca.crt`)를 OS나 브라우저가 신뢰해야 합니다.

로컬 라우트는 등록한 호스트를 대상 호스트와 포트로 보냅니다. 예: `api.example.dev` → `127.0.0.1:3000`. 이름은 전체가 같아야 맞습니다. `/etc/hosts`나 DNS는 바꾸지 않고, `localhost` 대상은 `127.0.0.1`로 연결합니다. 라우트 대상은 호스트와 포트입니다. 도메인 패널의 프록시 라우팅이나 **도구 → 프록시 연결 맵**에서 넣습니다.

기본으로는 이 PC만 받습니다. **다른 기기 접속 허용**을 켜면 LAN과 Tailscale(100.64/10) 같은 사설 대역에서 프록시와 안내 페이지에 붙을 수 있고, 프록시나 앱을 다시 시작한 뒤에 적용됩니다. 응답 CORS 재작성은 기본으로 켜져 있으며, 등록하지 않은 호스트에도 붙습니다.

### API 모킹

백엔드 전에 상태 코드와 JSON을 고정해 두고 화면을 붙입니다.

**도구 → API 모킹**에서 메서드, URL 패턴, 상태 코드, 응답 헤더, 본문을 지정합니다. 패턴에는 `*`를 쓸 수 있고, 캡처한 API 로그에서 규칙을 만들 수도 있습니다. HTTPS를 가로채려면 그 호스트의 복호화가 켜져 있어야 하고, 프록시가 꺼져 있으면 규칙은 적용되지 않습니다.

목 응답을 보내기 전에 규칙의 지연 시간만큼 기다립니다. 단위는 밀리초이고, 0이면 바로 보냅니다. 30000을 넘기면 30초로 맞춥니다. 프록시를 탄 페이지의 모킹 편집기에서 **지연 시간 (ms)** 에 넣거나, `hgc create_mock_rule`의 `delayMs`로 넣습니다. 만들 때 `delayMs`를 생략하면 0입니다. `hgc update_mock_rule`에서 `delayMs`를 생략하면 저장해 둔 지연은 바꾸지 않습니다.

시나리오를 지정하지 않으면 규칙은 기본 시나리오 `Default`에 붙습니다. 이 규칙은 켜져 있으면 요청에 맞으며, `Default`를 꺼도 같습니다. 그 외 시나리오에 넣은 규칙은 그 시나리오가 켜져 있을 때만 맞습니다. 시나리오를 하나 켜면 나머지는 꺼집니다. 켜진 시나리오의 규칙과 `Default` 규칙이 같은 요청에 맞으면 켜진 시나리오의 규칙을 쓰고, 같은 쪽에서 여러 규칙이 맞으면 먼저 저장한 규칙을 씁니다. `Default`가 아닌 시나리오가 하나도 켜져 있지 않으면 `Default` 규칙만 응답합니다. 시나리오는 `hgc create_scenario`로 만들고, `hgc set_scenario_enabled`로 켜고 끕니다. `hgc update_scenario`의 `enabled`도 같은 값을 바꿉니다. 앱에서는 Ctrl+P 명령 팔레트의 **[모킹] 실행: 테스트 시나리오 활성화**로 하나를 켭니다.

### OpenAPI와 API 로그

스펙을 보면서 엔드포인트를 호출하고, 지나간 요청은 나중에 다시 봅니다.

도메인에 OpenAPI/Swagger JSON 주소를 저장한 뒤 **도구 → API 스키마**에서 태그, 엔드포인트, 파라미터를 보고 요청을 보냅니다. 스펙에서 목 규칙을 만들지는 않습니다. 응답 본문용 JSON 스키마는 **도구 → JSON 스키마**에 따로 둡니다.

API 로그는 날짜별로 디스크에 쌓입니다. 보관 기간은 7일, 14일(기본), 30일, 90일, 무제한 중에서 고릅니다.

### 도메인 상태

개발·스테이징 주소가 응답하는지 상태 코드와 시간으로 확인합니다.

등록한 URL에 HEAD를 보내고, 상태 코드, 걸린 시간, 그룹 이름을 남깁니다. 그룹은 사이드바에서 묶고, **도구 → 모니터링 관리**와 모니터 로그에서 봅니다. 인증서 만료일은 확인하지 않습니다. 연결에 실패하면 요청 오류로 남습니다.

### `hgc`

터미널과 코딩 에이전트가 라우트, 목, 도메인을 직접 조작합니다.

Windows에서 `hgc`는 관리자 권한 없이 도는 콘솔 프로그램입니다. 창을 켜 두지 않아도 실행됩니다. 앱이 이미 떠 있으면 거기에 붙고, 아니면 필요한 서비스를 잠깐 띄운 뒤 결과를 출력하고 끝납니다. 설치 중 PATH 추가는 선택이며, 조용한 업데이트 설치에서는 묻지 않습니다.

`hgc init` 대상은 `auto`, `all`, `cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`입니다.

### 휴대폰

PC의 프록시를 안드로이드나 같은 네트워크의 폰에 연결합니다.

**설정 → 프록시 → 모바일 연결**에서 다룹니다.

- Android USB는 PC에 `adb`가 있어야 합니다. USB 탭을 켜면 연결된 기기에 `adb reverse tcp:<프록시 포트> tcp:<프록시 포트>`를 겁니다.
- 무선은 같은 Wi-Fi의 LAN 주소를 먼저 보여 줍니다. Tailscale은 선택이며, 휴대폰이 같은 Wi-Fi에 없을 때 씁니다. 실행 중이면 `100.`으로 시작하는 IPv4를 보여 줍니다. LAN이나 Tailscale로 붙으려면 **다른 기기 접속 허용**이 켜져 있어야 합니다.
- PC에 설치한 `cloudflared`로 여는 임시 터널은 LAN이나 Tailscale이 아닐 때의 선택입니다. 터널은 설정 페이지만 열고, 프록시를 타려면 **다른 기기 접속 허용**이 켜져 있어야 합니다. QR은 다른 기기 접속을 허용했거나 터널을 켰을 때 나옵니다. 연 페이지의 PAC나 수동 프록시를 기기 Wi-Fi에 넣습니다.
- iPhone USB 연결은 지원하지 않습니다. 무선 탭에서 같은 Wi-Fi를 쓰고, 다른 망일 때만 Tailscale을 사용합니다.

### UI/UX 가이드

서비스 화면의 가이드를 호스트별로 모아 두고, 필요할 때 PDF로 뽑습니다.

**도구 → UI/UX 가이드**에서 편집합니다. 묶음은 JSON으로 가져오고 내보냅니다.

### 그 밖의 도구

API를 직접 부르거나, 데이터 가공과 화면 확인에 쓰는 도구도 같은 메뉴에 있습니다.

**도구**에서 API 클라이언트, 데이터 파이프라인, 암복호화 유틸, UI 프리뷰, 서버 로그, Live Capture를 엽니다.

### 실험 기능: 투명 프록시

시스템 프록시 없이, 고른 Windows 프로그램의 웹 트래픽만 가로챕니다. 실험 기능입니다.

**설정 → 프록시**의 투명 프록시가 WinDivert로 선택 프로세스의 80/443 아웃바운드를 받습니다. 관리자 권한과 이미 켜진 로컬 프록시가 필요합니다. Windows x64 설치본에만 들어 있고, Windows ARM용은 없습니다. 연결이 끊기면 바로 꺼 주세요.

---

## 설치

[GitHub Releases](https://github.com/delete-horizon/horizon-gateway/releases)에서 받습니다. Windows x64, macOS Apple Silicon, macOS Intel, Linux x64용을 제공합니다. Windows ARM과 Linux ARM용은 없습니다. Linux 패키지는 Ubuntu 22.04에서 빌드합니다.

v2.8.15 설치 파일 크기입니다. 숫자는 십진 MB입니다.

| 운영체제 | 받는 파일 | 아키텍처 | 크기 |
|---|---|---|---|
| Windows | NSIS `horizon-gateway_*_x64-setup.exe` | x64 | 22.9MB |
| macOS | `horizon-gateway_*_aarch64.dmg`, `horizon-gateway_*_x64.dmg` | Apple Silicon, Intel 각각 | 30.5MB, 31.7MB |
| Linux | `.AppImage`, `.deb`, `.rpm` | x64 (`amd64` / `x86_64`) | AppImage 110.8MB, deb·rpm 33.7MB |

Windows 설치는 머신 단위라 설치할 때 권한 상승이 있습니다. `*.app.tar.gz`, `*.sig`, `latest.json`은 업데이트용입니다. `SHA256SUMS`는 설치 파일과 업데이터 바이너리의 SHA-256 목록입니다. [다운로드 검증](#다운로드-검증)을 보세요.

절차는 [시작 가이드](./docs/ko/getting-started.md)에 있습니다.

---

## 다운로드 검증

릴리스의 `SHA256SUMS`는 설치 파일과 업데이터 바이너리(`.exe`, `.dmg`, `.deb`, `.rpm`, `.AppImage`, `.app.tar.gz`)의 SHA-256입니다. `.sig`는 앱 업데이트용 minisign 서명이며, `latest.json`은 업데이트 목록입니다. 이 둘은 `SHA256SUMS`에 없습니다. 각 줄은 `<해시>  <파일 이름>`(공백 두 칸)이고, 파일 이름 순으로 정렬되어 있습니다.

`SHA256SUMS`와 확인하려는 파일을 같은 폴더에 받습니다.

Linux와 macOS에서는 GNU `sha256sum`을 씁니다. macOS에는 `brew install coreutils`로 설치합니다.

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

`--ignore-missing`은 폴더에 있는 파일만 검사하고, 받지 않은 이름은 건너뜁니다.

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

## 빠른 시작

1. Horizon Gateway를 실행하고, 상단 바의 **프록시 중지됨**을 눌러 설정을 연 다음 **프록시** 탭에서 프록시를 켭니다.
2. 같은 탭의 **HTTPS 인증서 (Root CA)** 에서 **인증서 저장**을 누릅니다. `horizon-gateway-root-ca.crt`를 OS나 브라우저가 신뢰하도록 등록합니다. Windows와 macOS 순서는 앱 안 프록시 설정 화면에 있습니다. Linux는 저장한 파일을 직접 신뢰로 등록합니다.
3. 프록시가 켜진 뒤 보이는 PAC URL을 시스템이나 브라우저 자동 프록시에 넣습니다.
4. 도메인을 추가하고 **HTTPS 복호화**를 켭니다. 우회 시드에 있는 호스트는 복호화되지 않습니다.
5. 로컬로 보낼 때는 **프록시 라우팅**이나 **도구 → 프록시 연결 맵**에서 대상 호스트와 포트를 넣습니다. 예: `127.0.0.1`, `3000`.
6. **도구 → API 모킹**에서 경로(예: `/api/users`)에 상태 코드와 JSON 본문을 가진 규칙을 만듭니다.

---

## AI 에이전트 (`hgc`)

```bash
# 현재 프로젝트에 스킬과 읽기 전용 MCP 설정을 넣습니다
hgc init --project

# 사용할 수 있는 명령을 봅니다
hgc list

# 명령 사용법과 입력 형식을 봅니다
hgc help get_domains

# 명령을 바로 실행합니다
hgc run get_domains '{}'

# stdio MCP 서버입니다. 기본은 읽기 전용입니다.
hgc mcp
hgc mcp --allow-write
hgc mcp --allow-body
```

`hgc init --project`는 `.agents/skills/horizon-gateway`에 스킬을 쓰고, Claude Code용 `.claude/skills/horizon-gateway`과 Windsurf용 `.windsurf/skills/horizon-gateway`로 연결합니다. Cursor, Codex, Gemini CLI, Copilot은 `.agents/skills`를 읽습니다. 같은 명령이 Cursor(`.cursor/mcp.json`), Claude Code(`.mcp.json`), Gemini CLI(`.gemini/settings.json`)에 읽기 전용 MCP 항목을 추가합니다.

### MCP

`hgc mcp`는 stdio에서 MCP `2026-07-28`로 말하고, CLI와 같은 제어 소켓과 로컬 토큰으로 코어에 접속합니다. 프로토콜 버전이 다르면 거부합니다.

기본 도구는 읽기 전용입니다. 프록시 상태, 라우트, 목, 도메인, 설정, 최근 트래픽 요약입니다. 요약은 method, host, 쿼리 값이 가려진 path, status, size, timing만 담고 헤더와 본문은 넣지 않습니다. `Authorization`과 `Cookie`는 나오지 않습니다. 본문 하나는 id로 따로 읽으며 4KB에서 자르고 신뢰할 수 없는 내용으로 표시합니다. `--allow-body` 또는 앱 데이터 디렉터리 `hgc-mcp.json`의 `allowBody`가 없으면 이 도구는 목록에 없습니다.

목과 라우트의 생성·수정·삭제, 프록시 시작·중지는 `--allow-write` 또는 `allowWrite: true`가 필요합니다. PAC 설정, 원격 접근 전환, 토큰 관리, 인증서 설치는 MCP로 열지 않습니다.

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

상태를 바꾸거나 캡처 본문을 읽혀도 될 때만 `args`에 `"--allow-write"` 또는 `"--allow-body"`를 넣습니다. 저장소 루트의 `server.json`은 MCP Registry용 문서입니다. 레지스트리에 올리려면 설치 가능한 패키지 항목(npm의 `mcpName`, OCI, NuGet, 또는 `fileSha256`이 있는 MCPB)이 더 필요합니다. `hgc`는 데스크톱 빌드에 포함되므로 `packages`는 아직 비어 있습니다.

`hgc mcp`는 항상 로컬 제어 소켓과 로컬 토큰을 씁니다. 원격 attach를 쓰지 않습니다.

### 원격 attach

원격 attach는 기본으로 꺼져 있습니다. 데몬을 `--remote-attach`, `HG_SERVE_REMOTE_ATTACH=1`, 또는 데이터 디렉터리의 `remote-attach.json`으로 켭니다. 바인드 주소는 Tailscale IP를 `--remote-bind`, `HG_SERVE_REMOTE_BIND`, 또는 `remote-attach.json`의 `bind`에 넣습니다. 주소를 비우면 `0.0.0.0`으로 붙고, 모든 인터페이스에서 듣는다는 경고를 로그에 남깁니다. 원격 접속은 TLS만 허용하고, 인증서는 처음 켤 때 만든 자가서명입니다. SHA-256 지문은 `--tls-fingerprint` 또는 `HG_SERVE_TLS_FINGERPRINT`로 고정합니다. 고정값이 없으면 `hgc`가 처음 본 지문을 저장합니다. 원격 토큰은 핸드셰이크 뒤에만 보냅니다(`--remote-token-file`, `--remote-token`, `HG_SERVE_REMOTE_TOKEN`). 기본 권한은 조회와 mock·route 편집입니다. 프록시 시작/중지, PAC 설정/해제, `allow_remote_access`, 토큰 재발급은 `HG_SERVE_REMOTE_SCOPE=admin`(또는 `full`)이 있어야 합니다. `reissue_remote_token`은 이전 토큰과 붙어 있는 원격 세션을 즉시 끊고, 새 토큰은 호스트의 `serve.remote.token`에만 기록합니다.

```bash
horizon-gateway-serve --remote-attach --remote-bind 100.64.0.2
hgc --attach 100.64.0.2:17345 --remote-token-file ./remote.token --tls-fingerprint <sha256> get_proxy_status '{}'
```

Windows PowerShell에서 JSON을 넘기는 방법은 [시작 가이드의 hgc 절](./docs/ko/getting-started.md#hgc)에 있습니다.

---

## 기술 스택

- **데스크톱 셸**: Tauri 2, Rust, Tokio, Hyper, Axum
- **UI**: React 19, Vite 7, TanStack Router, Jotai, Tailwind CSS 4, DaisyUI 5(베타)
- **도구**: TypeScript 5.8, Biome, pnpm

---

## 라이선스

[LICENSE](./LICENSE)가 원문입니다.

- 설치 프로그램이 기본으로 제공하는 기능은 개인용과 상업용 모두 무료입니다.
- 소스 저작권은 규연에게 있습니다. 소스를 무단으로 복제, 배포, 양도, 수정하거나 상업적으로 재배포하는 것은 금지됩니다.
- 만든 사람: 규연 (kyuyeon)
- 문의: `hello@delete-horizon.com`
- 변경 이력: [CHANGELOG.ko.md](./CHANGELOG.ko.md)
