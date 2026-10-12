[English README](../../README.md) | [한국어 README](../../README.ko.md)

# 시작하기

Horizon Gateway를 설치하고, 브라우저를 로컬 프록시로 보낸 다음, 한 호스트를 복호화해 로컬 포트로 돌리거나 목 응답을 내리는 순서입니다. 메뉴 이름은 앱을 한국어로 두었을 때입니다.

## 1. 설치

[GitHub Releases](https://github.com/delete-horizon/horizon-gateway/releases)에서 자신의 OS 파일을 받습니다. Windows x64, macOS Apple Silicon, macOS Intel, Linux x64용을 제공합니다. Windows ARM과 Linux ARM용은 없습니다.

| OS | 파일 | 비고 |
|---|---|---|
| Windows x64 | `horizon-gateway_<버전>_x64-setup.exe` | 머신 단위 설치라 설치할 때 권한 상승이 있습니다. 끝나면 `hgc`를 PATH에 넣을지 묻습니다. 조용한 업데이트 설치에서는 묻지 않습니다. |
| macOS Apple Silicon | `horizon-gateway_<버전>_aarch64.dmg` | Intel용 dmg와 별도입니다. |
| macOS Intel | `horizon-gateway_<버전>_x64.dmg` | |
| Linux x64 | `.AppImage`, `.deb`, `.rpm` | Ubuntu 22.04에서 빌드합니다. |

v2.8.15 크기는 Windows 설치 파일이 약 22MB, macOS dmg이 약 29–30MB, Linux deb·rpm이 약 32MB, AppImage가 약 106MB입니다.

`*.app.tar.gz`, `*.sig`, `latest.json`은 업데이트용입니다.

## 2. 프록시 켜기

1. 앱을 실행합니다.
2. 상단 바 왼쪽의 **프록시 중지됨**을 누릅니다. 설정이 열립니다.
3. **프록시** 탭에서 프록시를 켭니다. 표시가 **프록시 실행 중**으로 바뀝니다.

포워드 프록시 포트 기본값은 **8888**입니다. 같은 탭에서 리버스 HTTP/HTTPS 포트, DNS, CORS 재작성, 타임아웃, TLS 우회 시드를 바꿉니다. CORS 재작성은 기본으로 켜져 있고, 등록하지 않은 호스트의 응답에도 적용됩니다.

CONNECT 타임아웃 기본값은 15초, 그 외 업스트림은 30초입니다. 업스트림은 설정에서 1초에서 600초 사이로 바꿉니다. 로컬 라우트로 붙는 요청은 600초까지 기다립니다.

**다른 기기 접속 허용**은 기본으로 꺼져 있어서 프록시는 `127.0.0.1`만 받습니다. 켜면 사설 대역과 Tailscale(100.64/10)에서 접속할 수 있고, 다음 프록시 시작이나 앱을 다시 열 때 적용됩니다.

## 3. Root CA

HTTPS를 열려면 앱이 만든 루트 인증서를 이 PC가 신뢰해야 합니다.

1. **설정 → 프록시 → HTTPS 인증서 (Root CA)** 에서 **인증서 저장**을 누릅니다.
2. 파일 이름은 `horizon-gateway-root-ca.crt`입니다.
3. Windows와 macOS 순서는 앱의 프록시 설정 화면에 있습니다.
   - Windows: 인증서 설치 → 로컬 컴퓨터 → 모든 인증서를 다음 저장소에 → **신뢰할 수 있는 루트 인증 기관**.
   - macOS: `.crt`를 더블 클릭 → 키체인(시스템) → 인증서를 더블 클릭 → 신뢰 → 항상 신뢰.
4. 브라우저를 다시 띄웁니다.

Linux는 저장한 인증서를 배포판이나 브라우저의 신뢰 저장소에 직접 등록합니다.

인증서 고정이 있는 앱, 일부 SSO, 뱅킹, 캡티브 포털은 복호화 중에 깨질 수 있습니다. 그런 호스트는 **TLS 우회 시드**에 넣습니다. 우회 시드가 도메인의 복호화 스위치보다 우선합니다.

## 4. 브라우저가 프록시를 타게

프록시가 켜져 있으면 PAC 주소는 다음 형태입니다.

`http://127.0.0.1:<포트>/.horizon-gateway/proxy.pac`

앱에 적힌 위치는 다음과 같습니다.

- Windows: 설정 → 네트워크 및 인터넷 → 프록시 → 설정 스크립트 사용
- macOS: 시스템 설정 → 네트워크 → 고급 → 프록시 → 자동 프록시 구성 URL

수동 프록시는 주소 `127.0.0.1`, 포트는 포워드 프록시 포트입니다.

PAC는 `localhost`, `127.0.0.1`, `::1`, 이름에 `tailscale`이 들어가거나 `.ts.net`인 호스트, TLS 우회 시드에 해당하는 호스트를 직접 연결로 두고, 나머지는 이 프록시로 보냅니다.

## 5. 도메인과 HTTPS 복호화

1. 도메인을 추가합니다. 한 줄에 URL 하나입니다. 예: `https://api.example.dev`
2. 그 도메인 개요에서 **HTTPS 복호화**를 켭니다.

복호화 목록에 없거나 그 접미사와 맞지 않는 호스트는 터널로 지나갑니다. 이때 HTTPS 본문은 로그, 목, 인스펙터에 보이지 않습니다. 평문 HTTP는 이 스위치와 별개입니다.

이전에 살펴보기나 API 로그를 쓰던 호스트는 복호화가 이미 켜져 있을 수 있습니다.

## 6. 로컬 개발 서버로 보내기

도메인을 고른 뒤 **프록시 라우팅**에서 대상 호스트와 포트를 저장하거나, **도구 → 프록시 연결 맵**에서 라우트를 추가합니다.

예: 호스트 `api.example.dev`를 `127.0.0.1` 포트 `3000`으로.

- 호스트 이름 전체가 같아야 맞습니다. `api.example.dev` 라우트는 `foo.api.example.dev`까지 포함하지 않습니다.
- 대상이 `localhost`이면 `127.0.0.1`로 연결합니다.
- 로컬 라우트의 제한 시간은 600초입니다.
- 로컬 대상(`대상호스트:포트`, `localhost:포트`, `127.0.0.1:포트`)을 가리키는 `Location`은 브라우저가 본 호스트 주소로 다시 씁니다.

`/etc/hosts`는 바꾸지 않습니다. 라우트 대상은 호스트와 포트입니다.

## 7. API 목

1. 프록시를 켭니다. 꺼져 있으면 규칙이 적용되지 않습니다.
2. HTTPS라면 그 호스트의 복호화도 켭니다.
3. **도구 → API 모킹**에서 규칙을 추가합니다.
   - 메서드
   - URL 패턴. `*`를 쓸 수 있습니다. 예: `/api/users`, `/api/users*`
   - 상태 코드
   - 응답 헤더(JSON)와 본문

`Content-Type`을 비우면 `{`나 `[`로 시작하는 본문은 `application/json; charset=utf-8`, 그 외는 `text/plain; charset=utf-8`로 내려갑니다. 한글처럼 ASCII가 아닌 헤더 값은 URL 인코딩으로 들어갑니다.

캡처한 로그에서 규칙을 만들 수도 있습니다.

시나리오를 꺼 두어도 켜진 규칙은 그대로 응답합니다. 지연 시간 설정은 아직 응답에 적용되지 않습니다.

## 8. 도메인이 살아 있는지

모니터링을 켜면 등록 URL에 HEAD를 보냅니다. 로그에는 HTTP 상태, 걸린 시간(ms), 그룹 이름이 남습니다. **도구 → 모니터링 관리**와 **모니터 로그**에서 봅니다.

인증서 만료일은 확인하지 않습니다. 연결에 실패하면 요청 오류로 남습니다.

API 로그 보관 기본값은 14일입니다. 7일, 30일, 90일, 무제한 중에서 고릅니다. 텍스트와 JSON 본문은 2MB를 넘으면 잘립니다.

## 9. 휴대폰

**설정 → 프록시 → 모바일 연결**에서 설정합니다. 프록시가 켜져 있어야 합니다.

**Android USB.** PC에 `adb`(Android SDK platform-tools)가 있고, 폰에서 USB 디버깅이 켜져 있어야 합니다. USB 터널을 켜면 기기마다 다음을 실행합니다.

`adb -s <serial> reverse tcp:<프록시 포트> tcp:<프록시 포트>`

앱이 안내하는 설치 예는 Windows `choco install adb`, macOS `brew install --cask android-platform-tools`입니다.

**무선.** Tailscale을 쓰면 `100.`으로 시작하는 IPv4를 그 주소로 보여 줍니다. 처음 안내 페이지는 PC의 `cloudflared`로 임시 터널과 QR을 만듭니다. `cloudflared`는 따로 설치합니다. 없을 때 앱이 안내하는 명령은 Windows `winget install Cloudflare.cloudflared`, macOS `brew install cloudflared`입니다. QR로 연 페이지의 PAC나 수동 프록시를 기기 Wi-Fi에 넣습니다.

**iOS.** USB 연결은 지원하지 않습니다. 무선 탭의 Tailscale이나 Wi-Fi 프록시를 사용합니다.

## 10. UI/UX 가이드

**도구 → UI/UX 가이드**에서 호스트 패턴별로 가이드를 편집합니다. JSON으로 내보내고 가져옵니다. **PDF 리포트 생성**으로 저장본의 PDF를 만듭니다.

<a id="hgc"></a>

## 11. hgc

`hgc`는 창 없이 앱 명령을 실행하는 콘솔입니다. Windows에서는 관리자 권한이 필요 없습니다. 설치 폴더의 `hgc.exe`이며, PATH에 넣었다면 어느 터미널에서나 부릅니다.

프로젝트에 에이전트 스킬을 넣을 때:

```bash
hgc init                  # 전역 설치 (에이전트 자동 감지)
hgc init --target cursor  # 지정한 에이전트
hgc init --target all     # 지원하는 에이전트 전부
hgc init --project        # 현재 저장소: .agents/skills/horizon-gateway/
hgc init --print          # 설치하지 않고 SKILL.md만 출력
```

`--target` 값은 `auto`, `all`, `cursor`, `claude`, `codex`, `gemini`, `copilot`, `windsurf`입니다.

```bash
# 현재 프로젝트에 AI 에이전트 스킬을 넣습니다
hgc init --project

# 사용할 수 있는 명령을 봅니다
hgc list

# 명령 사용법과 입력 형식을 봅니다
hgc help get_domains

# 명령을 바로 실행합니다
hgc run get_domains '{}'
```

PowerShell에서는 JSON을 작은따옴표로 감싸고, 안의 큰따옴표는 이스케이프합니다.

```powershell
hgc set_local_route_enabled '{\"id\": 24, \"enabled\": true}'
```

내용이 길면 파일로 넘깁니다.

```powershell
hgc regist_domains @domains.json
hgc create_scenario - --payload @body.json   # 표준 입력
```

출력이 보이지 않으면 아래처럼 넘깁니다.

```powershell
hgc get_proxy_status '{}' | Out-String
```

`hgc list`와 `hgc help <command>`로 명령과 입력을 확인합니다. 스킬을 설치하면 앱을 켜지 않고 로그를 읽는 `scripts/logs.mjs`도 함께 들어옵니다.

## 12. 실험 기능

**투명 프록시**는 실험 기능입니다. Windows에서 WinDivert로 고른 프로세스의 아웃바운드 80/443을 가로챕니다. 드라이버를 여는 데 관리자 권한이 필요하고, 로컬 프록시가 켜져 있어야 합니다. 앱 목록은 스캔을 눌렀을 때만 가져옵니다. 연결이 끊기면 바로 꺼 주세요.

Windows x64용이며, Windows ARM용은 없습니다. 함께 넣는 WinDivert도 64비트입니다.

## 같이 보면 좋은 곳

- [한국어 README](../../README.ko.md)
- [변경 이력](../../CHANGELOG.ko.md)
- [라이선스](../../LICENSE)
- 웹사이트: <https://gateway.delete-horizon.com/ko>
