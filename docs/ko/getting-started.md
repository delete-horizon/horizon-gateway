[English README](../../README.md) | [한국어 README](../../README.ko.md)

# 시작하기

Horizon Gateway를 설치하고, 브라우저 트래픽을 로컬 프록시로 보낸 다음, 한 호스트를 복호화해 로컬 포트로 돌리거나 목 응답을 내리는 순서입니다. 메뉴 이름은 앱 언어가 한국어일 때 기준입니다.

릴리스가 만드는 설치 파일, 기본 포트, 복호화가 호스트 단위인 점은 저장소의 릴리스 워크플로와 프록시 코드와 맞춰 적었습니다.

## 1. 설치

[GitHub Releases](https://github.com/delete-horizon/horizon-gateway/releases)에서 자기 OS 파일을 받습니다.

| OS | 파일 | 비고 |
|---|---|---|
| Windows x64 | `horizon-gateway_<버전>_x64-setup.exe` | 머신 단위 설치라 설치 때 권한 상승이 있습니다. 끝나면 `hgc`를 PATH에 넣을지 묻습니다. 조용한 업데이트 설치에서는 묻지 않습니다. |
| macOS Apple Silicon | `horizon-gateway_<버전>_aarch64.dmg` | Intel용 dmg와 별도입니다. |
| macOS Intel | `horizon-gateway_<버전>_x64.dmg` | |
| Linux x64 | `.AppImage`, `.deb`, `.rpm` | ubuntu-22.04에서 빌드합니다. ARM 빌드는 릴리스 잡에 없습니다. |

v2.8.15 기준 크기는 Windows 설치 파일이 약 22MB, macOS dmg이 약 29–30MB, Linux deb·rpm이 약 32MB, AppImage가 약 106MB입니다.

`*.app.tar.gz`, `*.sig`, `latest.json`은 자동 업데이트용입니다.

## 2. 프록시 켜기

1. 앱을 실행합니다.
2. 상단 바 왼쪽의 **프록시 중지됨**을 누릅니다. 이 버튼은 스위치를 바로 뒤집지 않고 **설정**을 엽니다.
3. **프록시** 탭에서 프록시를 켭니다. 뱃지가 **프록시 실행 중**으로 바뀝니다.

포워드 프록시 포트 기본값은 **8888**입니다. 같은 탭에서 리버스 HTTP/HTTPS 포트, DNS, CORS 재작성, 타임아웃, TLS 우회 시드를 바꿉니다. CORS 재작성 기본값은 켜짐이고, 미등록 호스트 응답에도 적용됩니다.

**다른 기기 접속 허용**은 기본으로 꺼져 있어서 프록시는 `127.0.0.1`만 듣습니다. 켜면 사설 대역과 Tailscale(100.64/10) 피어를 받고, 다음 프록시 시작 또는 앱 재시작 때 적용됩니다.

## 3. Root CA

HTTPS를 열어 보려면 앱이 만든 루트 인증서를 이 PC가 신뢰해야 합니다.

1. **설정 → 프록시 → HTTPS 인증서 (Root CA)** 에서 **인증서 저장**을 누릅니다.
2. 저장되는 파일 이름은 `horizon-gateway-root-ca.crt`입니다.
3. 앱의 프록시 설정 화면에 Windows 설치 순서와 macOS 키체인 안내가 있습니다.
   - Windows: 인증서 설치 → 로컬 컴퓨터 → 모든 인증서를 다음 저장소에 → **신뢰할 수 있는 루트 인증 기관**.
   - macOS: `.crt` 더블 클릭 → 키체인(시스템) → 인증서 더블 클릭 → 신뢰 → 항상 신뢰.
4. 브라우저를 다시 띄웁니다.

Linux에서 이 파일을 어디에 신뢰로 넣을지는 그 화면에 없습니다. 배포판 또는 브라우저의 루트 저장소에 같은 파일을 넣으면 됩니다.

인증서 고정(pinning)이 있는 앱, 일부 SSO, 뱅킹, 캡티브 포털은 복호화 중에 깨질 수 있습니다. 그런 호스트는 **TLS 우회 시드**에 넣어 터널로 통과시킵니다. 우회 시드가 도메인의 복호화 토글보다 우선합니다.

## 4. 브라우저가 프록시를 타게

프록시가 켜져 있고 포트가 있으면 PAC 주소는 다음 형태입니다.

`http://127.0.0.1:<포트>/.horizon-gateway/proxy.pac`

앱이 적어 둔 OS 위치는 다음과 같습니다.

- Windows: 설정 → 네트워크 및 인터넷 → 프록시 → 설정 스크립트 사용
- macOS: 시스템 설정 → 네트워크 → 고급 → 프록시 → 자동 프록시 구성 URL

PAC 대신 수동 프록시를 쓸 때는 주소 `127.0.0.1`, 포트는 포워드 프록시 포트입니다.

PAC는 `localhost`, `127.0.0.1`, `::1`, 이름에 `tailscale`이 들어가거나 `.ts.net`인 호스트, 그리고 TLS 우회 시드에 해당하는 호스트를 `DIRECT`로 두고 나머지는 이 프록시로 보냅니다.

## 5. 도메인과 HTTPS 복호화

1. 도메인을 추가합니다. 한 줄에 URL 하나입니다. 예: `https://api.example.dev`
2. 그 도메인 개요에서 **HTTPS 복호화**를 켭니다.

복호화 목록에 없거나, 목록 항목의 접미사와 맞지 않는 호스트의 CONNECT는 터널입니다. HTTPS 페이로드는 로그·목·인스펙터에 보이지 않습니다. 평문 HTTP는 이 토글과 별개입니다.

예전에 인스펙트나 API 로깅에 쓰이던 호스트는 마이그레이션으로 복호화가 이미 켜져 있을 수 있습니다.

## 6. 로컬 개발 서버로 보내기

도메인을 고른 뒤 **프록시 라우팅**에서 대상 호스트와 포트를 저장하거나, **도구 → 프록시 연결 맵**에서 라우트를 추가합니다.

예: 호스트 `api.example.dev`를 `127.0.0.1` 포트 `3000`으로.

- 비교는 호스트 전체입니다. `api.example.dev` 라우트가 `foo.api.example.dev`까지 커버하지는 않습니다.
- 대상이 `localhost`이면 연결은 `127.0.0.1`로 갑니다.
- 로컬 라우트 업스트림 제한은 600초입니다. 그 외 업스트림 기본값은 30초이고, 설정에서는 1초에서 600초 사이로 바꿉니다.
- 로컬 대상(`대상호스트:포트`, `localhost:포트`, `127.0.0.1:포트`)을 가리키는 `Location`은 브라우저가 본 호스트 URL로 다시 씁니다.

`/etc/hosts`는 바꾸지 않습니다. 대상은 호스트와 포트입니다. 정적 파일 디렉터리를 라우트 대상으로 넣는 필드는 없습니다.

## 7. API 목

1. 프록시가 켜져 있는지 확인합니다. 꺼져 있으면 규칙이 적용되지 않습니다.
2. HTTPS라면 5절처럼 그 호스트의 복호화가 켜져 있어야 합니다.
3. **도구 → API 모킹**에서 규칙을 추가합니다.
   - 메서드
   - URL 패턴. `*`를 쓸 수 있습니다. 예: `/api/users`, `/api/users*`
   - 상태 코드
   - 응답 헤더(JSON)와 본문

`Content-Type`을 비우면, `{` 또는 `[`로 시작하는 본문은 `application/json; charset=utf-8`, 그 외는 `text/plain; charset=utf-8`입니다. ASCII가 아닌 헤더 값은 URL 인코딩으로 넣습니다.

캡처된 로그에서 규칙을 만드는 동작도 있습니다.

시나리오 레코드와 `hgc`의 시나리오 명령은 있습니다. 프록시가 규칙을 고를 때는 시나리오가 켜져 있는지는 보지 않고, 규칙의 `enabled`만 봅니다.

페이지에 주입되는 목 편집기에는 지연 시간(ms) 칸이 있습니다. 프록시 규칙 구조에는 그 필드가 없고, 목 응답을 만들기 전에 기다리는 코드도 없습니다.

## 8. 도메인이 살아 있는지

모니터링을 켜 두면 등록 URL에 HEAD를 보냅니다. 로그에는 HTTP 상태, 걸린 시간(ms), 그룹 이름이 남습니다. **도구 → 모니터링 관리**, **모니터 로그**에서 봅니다.

인증서 만료나 체인 검증 결과를 따로 저장하지는 않습니다. 연결 자체가 실패하면 요청 오류로 남습니다.

API 로그 보관 기본값은 14일입니다. 7, 30, 90일 또는 무제한을 고를 수 있습니다. 텍스트·JSON 본문은 2MB를 넘으면 잘립니다.

## 9. 휴대폰

**설정 → 프록시 → 모바일 연결**입니다. 프록시가 켜져 있어야 기기 연결을 설정할 수 있습니다.

**Android USB.** PC에 `adb`(Android SDK platform-tools)가 있고 USB 디버깅이 켜진 기기가 보여야 합니다. USB 터널을 켜면 각 기기에 다음을 실행합니다.

`adb -s <serial> reverse tcp:<프록시 포트> tcp:<프록시 포트>`

앱이 설치 명령으로 안내하는 예는 Windows `choco install adb`, macOS `brew install --cask android-platform-tools`입니다.

**무선.** Tailscale을 쓰는 경우 앱은 `100.`으로 시작하는 IPv4를 Tailscale 주소로 표시합니다. 최초 안내 페이지용으로 PC의 `cloudflared`를 띄워 임시 터널과 QR을 만듭니다. `cloudflared`가 없으면 터널은 실패하고, 앱은 Windows `winget install Cloudflare.cloudflared`, macOS `brew install cloudflared`를 안내합니다. QR로 연 페이지의 PAC 또는 수동 프록시를 기기 Wi-Fi에 넣습니다.

**iOS.** USB 역방향 포워딩은 지원하지 않는다고 앱이 안내합니다. 무선 탭의 Tailscale 또는 Wi-Fi 프록시를 씁니다.

## 10. UI/UX 가이드

**도구 → UI/UX 가이드**에서 호스트 패턴별로 가이드를 편집합니다. JSON으로 내보내고 가져옵니다. **PDF 리포트 생성**은 저장본으로 PDF를 만듭니다.

<a id="hgc"></a>

## 11. hgc

`hgc`는 GUI 없이 앱 명령을 실행하는 콘솔입니다. Windows에서는 관리자 권한이 필요 없습니다. 설치 디렉터리의 `hgc.exe`이며, 설치 중 PATH에 넣었다면 아무 터미널에서 호출합니다.

프로젝트에 에이전트 스킬을 넣을 때:

```bash
hgc init                  # global install (auto-detect agent)
hgc init --target cursor  # specific agent
hgc init --target all     # all supported agents
hgc init --project        # current repo: .agents/skills/horizon-gateway/
hgc init --print          # print SKILL.md without installing
```

`--target` 값: `auto`, `all`, `cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`.

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

Windows PowerShell은 JSON 인용을 먹습니다. 페이로드는 작은따옴표로 감싸고 안의 큰따옴표는 이스케이프합니다.

```powershell
hgc set_local_route_enabled '{\"id\": 24, \"enabled\": true}'
```

복잡한 JSON은 파일이 낫습니다.

```powershell
hgc regist_domains @domains.json
hgc create_scenario - --payload @body.json   # stdin
```

출력이 비면 다음이 안전한 우회입니다.

```powershell
hgc get_proxy_status '{}' | Out-String
```

명령 목록과 페이로드 필드는 `hgc list`, `hgc help <command>`가 그 설치본 기준의 소스입니다. 스킬을 설치하면 로그를 앱 없이 읽는 `scripts/logs.mjs`도 같이 들어옵니다.

## 12. 실험 기능

**투명 프록시**는 설정에 실험 기능이라고 표시됩니다. Windows에서만 WinDivert로 동작하고, 선택한 프로세스의 아웃바운드 80/443을 가로챕니다. 드라이버 초기화에 관리자 권한이 필요하고, 로컬 프록시가 떠 있어야 합니다. 앱 목록은 스캔 버튼을 눌렀을 때만 가져옵니다. 연결이 이상하면 그 토글을 끕니다.

릴리스 워크플로에 Windows ARM 잡은 없고, 함께 넣는 WinDivert 파일도 64비트입니다.

## 같이 보면 좋은 곳

- [한국어 README](../../README.ko.md)
- [변경 이력](../../CHANGELOG.ko.md)
- [라이선스](../../LICENSE)
- 웹사이트: <https://gateway.delete-horizon.com/ko>
