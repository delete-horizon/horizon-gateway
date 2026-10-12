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

프론트를 먼저 붙일 때 백엔드 JSON이 아직 없거나, 스테이징 호스트를 내 머신의 `localhost:3000`으로 돌려야 할 때 쓰는 로컬 도구입니다. 브라우저가 프록시를 타면 HTTPS를 호스트 단위로 열어 보고, 규칙에 맞는 요청에는 지정한 상태 코드와 본문을 대신 내려줍니다. 등록한 도메인은 HEAD로 상태 코드와 응답 시간을 남깁니다.

보통 이 자리를 Charles·Proxyman, Mockoon·Postman, ngrok·Cloudflare Tunnel, 브라우저 개발자 도구와 시트가 나눠 갖습니다. Horizon Gateway는 그 로컬 작업을 Tauri 2 데스크톱 앱과 콘솔 `hgc`로 모읍니다.

현재 릴리스(v2.8.15) Windows 설치 파일은 약 22MB입니다. 메모리 사용량을 다른 데스크톱 셸과 비교한 수치는 저장소에 없습니다.

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

Hyper·Tokio 기반 로컬 프록시입니다. 기본 수신 포트는 8888이고, 설정에서 바꿀 수 있습니다.

프록시가 켜지면 PAC 주소가 생깁니다.

`http://127.0.0.1:<포트>/.horizon-gateway/proxy.pac`

이 주소를 시스템 또는 브라우저의 자동 프록시 구성에 넣습니다. 수동 프록시는 `127.0.0.1`과 포워드 프록시 포트입니다.

HTTPS 본문(로그, 목, 인스펙터)을 보려면 해당 도메인에서 **HTTPS 복호화**를 켭니다. 복호화 목록에 없거나 그 접미사와 맞지 않는 호스트는 터널로 통과합니다. 설정의 **TLS 우회 시드**에 있는 호스트는 복호화보다 우선합니다. 처음 깔면 Teams, Slack, Zoom, Discord, Microsoft·Google·Apple·Okta·Auth0 로그인, 캡티브 포털 확인 주소가 우회 목록에 들어 있습니다. 한 줄에 호스트 하나로 고칩니다. 복호화에는 앱 Root CA를 OS 또는 브라우저가 신뢰해야 합니다. 인증서 파일 이름은 `horizon-gateway-root-ca.crt`입니다.

**로컬 라우트**는 등록한 도메인 호스트를 대상 호스트와 포트로 보냅니다. 예: `api.example.dev` → `127.0.0.1:3000`. 매칭은 호스트 전체의 대소문자 무시 일치입니다. `/etc/hosts`나 DNS를 바꾸지 않습니다. `localhost` 대상은 `127.0.0.1`로 붙여 연결합니다. 라우트는 도메인 패널의 프록시 라우팅, 또는 **도구 → 프록시 연결 맵**에서 넣습니다.

기본값은 이 PC(`127.0.0.1`)만 받습니다. **다른 기기 접속 허용**을 켜면 LAN·Tailscale(100.64/10) 등 사설 대역에서 프록시와 안내 페이지에 붙을 수 있고, 프록시 재시작 또는 앱 재시작 후 적용됩니다.

응답 CORS 재작성은 기본으로 켜져 있고, 미등록 호스트 응답에도 붙습니다. 업스트림 타임아웃 기본값은 30초, CONNECT는 15초입니다. 로컬 라우트로 붙는 업스트림 제한은 600초입니다.

### API 모킹

**도구 → API 모킹**에서 규칙을 만듭니다. 메서드, URL 패턴, 상태 코드, 응답 헤더, 본문을 지정합니다. URL 패턴에는 `*`를 쓸 수 있습니다. 헤더에 `Content-Type`이 없으면 JSON으로 보이는 본문은 `application/json`, 그 외는 `text/plain`으로 내려갑니다. 캡처한 API 로그에서 규칙을 만드는 경로도 있습니다.

프록시는 **켜진 규칙**만 보고 응답합니다. 시나리오 데이터와 `hgc`의 시나리오 명령은 남아 있지만, 시나리오 켜짐 여부는 현재 매칭에 쓰이지 않습니다. 페이지에 주입되는 편집기에는 지연 시간(ms) 입력이 있지만, 프록시가 저장하는 규칙에는 그 필드가 없고 응답을 늦추지도 않습니다.

HTTPS 요청을 가로채 목을 내려면 그 호스트의 HTTPS 복호화가 켜져 있어야 합니다. 프록시가 꺼져 있으면 규칙은 적용되지 않습니다.

### OpenAPI와 API 로그

도메인에 OpenAPI/Swagger JSON URL을 저장하고 받아 온 뒤, **도구 → API 스키마**에서 태그·엔드포인트·파라미터를 보고 요청을 보냅니다. 스키마에서 목 규칙을 자동 생성하지는 않습니다. 응답 본문용 JSON 스키마는 **도구 → JSON 스키마**에 따로 둡니다.

API 로그는 날짜별로 디스크에 쌓입니다. 텍스트·JSON 본문 저장은 2MB에서 잘립니다. 보관 기간은 7일, 14일(기본), 30일, 90일, 무제한입니다.

### 도메인 상태

등록한 URL에 HEAD를 보내고 상태 코드, 소요 시간, 그룹 이름을 로그로 남깁니다. 그룹은 사이드바에서 묶습니다. **도구 → 모니터링 관리**와 모니터 로그에서 봅니다. 인증서 만료일을 따로 계산하지는 않습니다. TLS 실패는 요청 오류로 남습니다.

### `hgc`

Windows 설치본의 `hgc`는 관리자 권한 없이 도는 콘솔 프로그램입니다(`asInvoker`). GUI를 켜 두지 않아도 명령을 실행합니다. 백엔드가 이미 있으면 IPC로 붙고, 없으면 필요한 서비스를 띄운 뒤 JSON을 출력하고 끝납니다. Windows 설치 중 PATH 추가는 선택입니다. 자동 업데이트처럼 조용한 설치에서는 PATH를 묻지 않습니다.

`hgc init`이 넣는 에이전트 스킬 대상은 `auto`, `all`, `cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`입니다.

### 휴대폰

**설정 → 프록시 → 모바일 연결**입니다.

- Android USB: platform-tools의 `adb`가 있어야 합니다. USB 탭에서 켜면 연결된 기기에 `adb reverse tcp:<프록시 포트> tcp:<프록시 포트>`를 겁니다.
- 무선: PC에 설치된 `cloudflared`로 임시 터널을 열고 QR로 안내 페이지를 띄운 뒤, 기기 Wi-Fi에 PAC 또는 수동 프록시를 넣습니다. `cloudflared`는 앱에 포함되어 있지 않습니다. Tailscale 칸은 `100.`으로 시작하는 IPv4를 그 주소로 보여 줍니다.
- iOS USB 역방향 포워딩은 앱이 지원하지 않습니다. iPhone은 무선 탭의 Tailscale 또는 Wi-Fi 프록시를 씁니다.

### UI/UX 가이드

**도구 → UI/UX 가이드**에서 호스트별 가이드를 저장하고 편집합니다. 묶음은 JSON으로 가져오고 내보낼 수 있고, 저장본으로 PDF 리포트를 만듭니다.

### 그 밖의 도구

같은 **도구** 메뉴에 API 클라이언트, 데이터 파이프라인, 암복호화 유틸, UI 프리뷰, 서버 로그, Live Capture가 있습니다.

### 실험 기능: 투명 프록시

**설정 → 프록시**의 **투명 프록시**는 실험 기능입니다. Windows에서 WinDivert로 고른 프로세스의 80/443 아웃바운드를 가로챕니다. 관리자 권한으로 뜨는 백엔드와, 이미 켜진 로컬 프록시가 필요합니다. WinDivert 파일은 Windows x64 설치본에만 들어 있습니다. 릴리스 잡에 Windows ARM은 없습니다. 앱 문구 그대로, 연결이 끊기면 바로 끄면 됩니다.

---

## 설치

[GitHub Releases](https://github.com/delete-horizon/horizon-gateway/releases)의 설치 파일을 받습니다. 릴리스 워크플로는 Windows x64, macOS Apple Silicon(`aarch64`), macOS Intel(`x86_64`), Linux x64(ubuntu-22.04)를 빌드합니다. Windows ARM과 Linux ARM 설치 파일은 이 워크플로에 없습니다.

v2.8.15 자산 크기입니다. 이후 태그에서는 달라질 수 있습니다.

| 운영체제 | 받는 파일 | 아키텍처 | v2.8.15 크기 |
|---|---|---|---|
| Windows | NSIS `horizon-gateway_*_x64-setup.exe` | x64 | 약 22MB |
| macOS | `horizon-gateway_*_aarch64.dmg`, `horizon-gateway_*_x64.dmg` | Apple Silicon, Intel 각각 | 약 29MB, 약 30MB |
| Linux | `.AppImage`, `.deb`, `.rpm` | x64 (`amd64` / `x86_64`) | AppImage 약 106MB, deb·rpm 약 32MB |

Windows 설치는 머신 단위(`perMachine`)라 설치 때 권한 상승이 있습니다. `*.app.tar.gz`와 `*.sig`, `latest.json`은 업데이터용입니다.

따라 하는 절차는 [시작 가이드](./docs/ko/getting-started.md)에 있습니다.

---

## 빠른 시작

1. Horizon Gateway를 실행하고, 상단 바의 **프록시 중지됨**을 눌러 설정을 연 다음 **프록시** 탭에서 프록시를 켭니다.
2. 같은 탭의 **HTTPS 인증서 (Root CA)** 에서 **인증서 저장**을 누릅니다. 저장된 `horizon-gateway-root-ca.crt`를 OS 또는 브라우저가 신뢰하게 설치합니다. Windows·macOS 클릭 순서는 앱 안 프록시 설정 화면에 있습니다. Linux용 단계는 그 화면에 없습니다.
3. 프록시가 켜진 뒤 보이는 PAC URL을 시스템 또는 브라우저 자동 프록시에 넣습니다.
4. 도메인을 추가하고, 그 도메인에서 **HTTPS 복호화**를 켭니다. 우회 시드에 있는 호스트는 복호화되지 않습니다.
5. 로컬로 보낼 거면 **프록시 라우팅** 또는 **도구 → 프록시 연결 맵**에서 대상 호스트와 포트를 넣습니다. 예: `127.0.0.1`, `3000`.
6. **도구 → API 모킹**에서 경로(예: `/api/users`)에 상태 코드와 JSON 본문을 가진 규칙을 만듭니다.

---

## AI 에이전트 (`hgc`)

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

Windows PowerShell에서 JSON을 넘길 때의 인용과 파일 페이로드는 [시작 가이드의 hgc 절](./docs/ko/getting-started.md#hgc)과 앱에 포함된 스킬 문서가 다룹니다.

---

## 기술 스택

- **데스크톱 셸**: Tauri 2, Rust, Tokio, Hyper, Axum
- **UI**: React 19, Vite 7, TanStack Router, Jotai, Tailwind CSS 4, DaisyUI 5
- **도구**: TypeScript 5.8, Biome, pnpm

버전 숫자는 저장소 `package.json`과 `src-tauri/*/Cargo.toml` 기준입니다. DaisyUI 패키지는 5.x 베타입니다.

---

## 라이선스

[LICENSE](./LICENSE)가 원문입니다.

- 설치 프로그램이 기본으로 제공하는 기능은 개인용과 상업용 모두 무료입니다.
- 소스 저작권은 규연에게 있습니다. 소스를 무단으로 복제, 배포, 양도, 수정하거나 상업적으로 재배포하는 것은 금지됩니다.
- 만든 사람: 규연 (kyuyeon)
- 문의: `hello@delete-horizon.com`
- 변경 이력: [CHANGELOG.ko.md](./CHANGELOG.ko.md)
