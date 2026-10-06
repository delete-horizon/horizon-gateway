# Core 추출 계획

- 작성일: 2026-10-06
- 상태: Draft (owner 검토용)
- 범위: 조사와 설계만. 이 문서는 코드 변경을 포함하지 않는다.
- 기준 트리: `main` @ `1787ecd` (PR #9 merge). `docs/ROADMAP.md`는 이 커밋의 `main`에 없다. Phase 1 방향은 열린 PR #10 (`cursor/docs-roadmap-7abb`)의 draft를 따랐다.
- 제품 목표 (roadmap Phase 1): proxy / mock / routing을 GUI 없이 도는 **headless core**로 두고, desktop (Tauri)와 이후 web UI는 그 core에 attach하는 thin client로 만든다.

이 문서는 “아직 모놀리스다”라는 전제로 쓰지 않았다. 코드를 읽어 보면 **프로세스 분리는 이미 되어 있다.** 남아 있는 일은 그 프로세스를 GUI·트레이·고정 로컬 포트에서 떼어, 버전된 client API로 고정하는 것이다.

---

## 1. 현재 구조 맵

Cargo workspace는 `src-tauri/Cargo.toml`이다. 멤버는 `hg-core`, `hg-avatar`, `hg-gui`, `hg-serve`, `hgc`다. 역할은 `src-tauri/INDEX.md`와 대체로 일치한다.

| 경로 | crate / package | 하는 일 |
| :--- | :--- | :--- |
| `src-tauri/hg-core` | `hg-core` | GUI와 serve가 공유하는 모델과 wire protocol. OS I/O 없음. |
| `src-tauri/hg-serve` | `horizon-gateway-serve` (lib `horizon_gateway_serve_lib`, bin `horizon-gateway-serve`) | proxy, mock, storage, CLI library, chat P2P. Tauri 의존성 없음. |
| `src-tauri/hgc` | `hgc` | console binary. `horizon-gateway-serve` lib의 `cli::execute_cli_entry`만 호출한다. |
| `src-tauri/hg-gui` | `horizon-gateway` (bin), `horizon-gateway-workspace` (`workspace-shell` feature) | Tauri 2 shell. 창, overlay, updater, deep link. backend command는 프로세스로 넘긴다. |
| `src-tauri/hg-avatar` | `hg-avatar` | avatar catalog. serve와 GUI가 둘 다 의존한다. |
| `src/` | React + Vite | TanStack routes, FSD slice. Tauri `invoke` / `listen`. |
| `website/` | Astro | 마케팅 사이트. 앱 client가 아니다. |

### `hgc`는 별도 binary다

`hgc`는 Tauri 앱의 subcommand가 아니다. `src-tauri/hgc/src/main.rs`가 `horizon_gateway_serve_lib::cli::execute_cli_entry`를 호출하는 thin binary다. Windows에서 serve의 admin manifest를 물려받지 않게 하려고 crate를 나눈 주석이 Cargo.toml과 main에 있다.

호환 경로는 남아 있다. `src-tauri/hg-gui/src/main.rs`는 첫 인자가 `cli`이면 `horizon_gateway_lib::execute_cli`로 가고, 그 함수(`hg-gui/src/lib.rs`)는 `hgc` executable을 spawn한다. `horizon-gateway-serve` binary는 `cli` / `init` / `list` / `run`을 거부하고 `hgc`를 쓰라고 종료한다 (`hg-serve/src/main.rs`).

`hgc`의 실행은 두 갈래다 (`hg-serve/src/cli/mod.rs`의 `execute_cli_entry`).

1. `127.0.0.1:17345`가 열려 있으면 `execute_run_via_serve`로 떠 있는 daemon에 IPC를 보낸다.
2. 아니면 `bootstrap_app_context`로 **같은 프로세스 안에서** 서비스를 올리고 `dispatch_headless`를 한 번 돌린 뒤 종료한다. proxy listener를 남기지 않는다.

skill 문서(`src-tauri/hg-gui/resources/skills/horizon-gateway/SKILL.md`)도 이 동작을 적는다. “GUI 없이 동작”은 맞지만, “daemon이 계속 떠 있다”와는 다르다.

### 기능이 실제로 있는 곳

모두 `hg-serve` 안이다. GUI crate에는 proxy / mock / CA 구현이 없다.

| 기능 | 위치 |
| :--- | :--- |
| HTTPS MITM proxy | `hg-serve/src/service/local_proxy/` — `server/server.rs`의 `run_proxy`, `tls/cert.rs`, `connect/decrypt.rs` |
| Host routing | `local_proxy/routing/resolver.rs`의 `resolve_target`, `routing/host.rs`의 `route_domain_to_host`. 입력은 `LocalRoute` 목록 |
| Mock | `service/mocking_service.rs` (`MockingService`), 적용은 `local_proxy/handler/mocking.rs`의 `try_mock_response` |
| Domain health-check | `service/domain_monitor_service.rs`의 `check_domains`. `serve/server.rs`가 120초마다 호출 |
| Root CA 생성·서명 | `service/ca_service.rs`의 `CaService::new`, `sign_host_certificate` |
| 제어 평면 | `serve/server.rs`의 `run_serve` / `dispatch_serve_request` → `cli/dispatch_headless.rs`의 `dispatch_headless` |
| 이벤트 | `serve/events.rs`의 `publish_event`, `start_event_listener` |
| 설정 저장 | `runtime/app_context.rs`의 `bootstrap_app_context`. JSON 파일은 `dirs::data_dir()/com.lurain.horizon-gateway/` |

Health-check와 routing은 **연결되어 있지 않다.** `check_domains`는 DNS/HTTP로 상태를 재고 `DomainStatusLog`를 남긴다. proxy가 로컬로 보낼지 말지는 `resolve_target`이 enabled `LocalRoute`의 host로만 결정한다. `local_proxy/` 안에서 monitor 상태를 읽는 코드는 찾지 못했다. roadmap이 말하는 “health-check 기반 routing”은 현재 코드의 한 함수가 아니다.

OpenAPI는 mock 엔진 자체가 아니다. schema 다운로드·조회·try-it-out은 `command/api_log_commands.rs` (`download_api_schema`, `get_api_schema_content`, `send_api_request`)이고, mock 매칭은 rule의 method/url pattern이다 (`try_mock_response`).

같은 프로세스에 roadmap Phase 1 범위 밖 기능도 들어 있다. chat P2P (`hg-serve/src/chat/`), Cloudflare/Tailscale tunnel (`service/tunnel_service.rs`), USB reverse (`service/usb_service.rs`), Windows transparent proxy (`service/transparent_proxy_service.rs`, WinDivert), inspector annotation, pipeline, crypto preset.

### Frontend가 backend를 부르는 방법

`src/bindings.ts`는 헤더에 “Tauri Specta가 생성했다”고 되어 있고, `@tauri-apps/api/core`의 `invoke`로 command 이름 문자열을 호출한다. 이벤트는 `@tauri-apps/api/event`의 `listen`이다 (예: `proxy-status-changed`, `api-log-captured`).

런타임 경로는 이렇다.

1. Webview가 `invoke("get_domains")` 등을 호출한다.
2. `hg-gui/src/serve/router.rs`의 `wrap_invoke_handler`가 command 이름을 본다.
3. `serve/forward.rs`의 `GUI_ONLY_COMMANDS`에 있으면 specta handler (창, overlay, updater).
4. 아니면 `serve/client.rs`의 `call_command`가 `127.0.0.1:17345`로 NDJSON `ServeRequest`를 보낸다.
5. serve 이벤트는 `serve/events_client.rs`의 `start_event_forwarder`가 `127.0.0.1:17346`을 구독해 `app.emit`으로 webview에 다시 쏜다.

GUI는 기동 시 `serve/ensure.rs`의 `ensure_running`으로 sidecar를 spawn하거나 재사용한다. companion (`horizon-gateway-workspace`)은 `HG_SERVE_ATTACH_ONLY=1`이라 기존 serve를 죽이지 않는다 (`hg-gui/src/lib.rs`의 `run_workspace`).

현재 `hg-gui`의 `get_specta_builder` (`lib.rs`)는 창·overlay command만 `collect_commands!`에 넣는다. `get_domains` 같은 backend command의 specta export 코드는 `src-tauri`에서 찾지 못했다. `bindings.ts`는 체크인된 산출물이고, 지금 GUI builder를 다시 export하면 backend command가 빠질 가능성이 있다. 확인을 위해 codegen을 다시 돌리지는 않았다.

### 패키징

`hg-gui/tauri.conf.json`의 `externalBin`이 `horizon-gateway-serve`, `hgc`, `horizon-gateway-workspace`를 sidecar로 넣는다. `beforeBuildCommand`가 `scripts/build-serve-sidecar.mjs`를 실행한다. Hub만 updater를 가진다 (`src-tauri/INDEX.md`).

---

## 2. 결합 평가

### 이미 분리된 것

- proxy, mock, domain monitor, CA 서명, JSON storage, command dispatch는 Tauri crate에 없다. `hg-serve/Cargo.toml`에 `tauri` dependency가 없다.
- GUI는 backend `State`를 들고 있지 않다. `AppHandle`은 창, overlay, 로그 emit, serve 이벤트 재emit에만 쓴다.
- IPC 타입은 `hg-core/src/protocol.rs`에 있다. `PROTOCOL_VERSION` (현재 `1`), `ServeRequest`, `ServeResponse`, `ServeEvent`, `ServeEventHello`, `serve_token_matches`.
- 세션 토큰은 serve가 띄운 뒤 `<data dir>/com.lurain.horizon-gateway/serve.token`에 owner-only로 쓴다 (`serve/auth.rs`의 `publish_token`). 요청과 이벤트 hello에 없으면 거부한다.
- `hgc`와 workspace GUI는 이미 “붙는 client”다. workspace는 attach-only다.

### Tauri 또는 데스크톱 런타임에 아직 묶인 것

**1. 제어 소켓이 고정 loopback이고, discovery 타입은 쓰이지 않는다.**

`protocol.rs`는 `SERVE_TCP_ADDR` (`127.0.0.1:17345`)와 `SERVE_EVENT_ADDR` (`127.0.0.1:17346`)를 deprecated라 하고 `ServeEndpoints`로 찾으라고 적는다. 그런데 `serve/server.rs`와 `serve/events.rs`는 그 상수를 `TcpListener::bind`에 그대로 쓴다. `ServeEndpoints`를 파일로 쓰거나 읽는 프로덕션 코드는 없다 (roundtrip 테스트만 `protocol.rs`에 있다). GUI client (`hg-gui/src/serve/client.rs`)와 serve client (`hg-serve/src/serve/client.rs`)도 같은 상수를 하드코드한다.

원격 web client가 붙을 주소·포트·버전을 협상하는 경로는 없다. `protocol_version`이 다르면 `ServeRequest::unsupported_version_error`로 거절하는 분기는 타입에만 있고, `handle_client`는 그 함수를 호출하지 않는다. 버전 필드는 직렬화될 뿐 서버가 검사하지 않는다.

**2. 이벤트 이름은 문자열이다.**

`ServeEvent`는 `{ event, payload }`다. 발행 예: `proxy-status-changed` (`command/local_route_commands.rs`), `api-log-captured` / `api-log-search-hit` (`command/api_log_commands.rs`), `annotations-updated`, `chat-frame-received`, `avatar-catalog-changed`, `avatar-draft`, `serve-stopping`, `show-main-window`. 스키마 레지스트리나 버전은 없다. GUI는 `show-main-window`와 `serve-stopping`만 특수 처리하고 나머지는 webview로 통과시킨다 (`events_client.rs`).

**3. 시스템 트레이가 core 프로세스에 있다.**

`serve/server.rs`의 `serve_loop`는 IPC accept 이후 항상 `serve/tray.rs`의 `start()`를 호출한다. non-Windows에서는 tray의 `tao` event loop가 메인 스레드를 잡고, IPC는 백그라운드 스레드다. 주석은 “macOS는 tray event loop가 메인 스레드여야 한다”이다. `hg-serve`는 non-Windows에서 `tray-icon`, `tao`, `png`에 링크된다. 트레이 메뉴 Open은 `show-main-window`를 발행하고, 옆에 있는 `horizon-gateway` binary를 spawn한다 (`find_gui_exe`).

데스크톱에서 tray를 없애는 변경이 아니다. headless 모드가 없어서, CI/컨테이너도 같은 진입점을 탄다. DISPLAY 없이 `event_loop.run`이 사는지 이 조사에서 실행해 보지는 않았다.

**4. Windows release serve는 administrator다.**

`hg-serve/build.rs`의 `embed_admin_manifest`가 release `horizon-gateway-serve`에 `windows-app-manifest.xml`의 `requireAdministrator`를 넣는다. debug manifest는 `asInvoker`다. transparent proxy (WinDivert) 때문이다. `hgc`는 일부러 이 manifest를 안 물려받는다. headless CI에서 release serve를 그대로 띄우면 UAC가 필요하다.

**5. CA 키는 serve의 파일이고, OS trust 설치 코드는 없다.**

`CaService::new`가 `app_data_dir/ca/root.key`와 `root.crt`를 만든다. 키는 `runtime/private_file.rs`의 `write_private_file`로 Unix `0600`이다. Windows는 “사용자 app data ACL을 따른다”는 주석만 있고 ACL을 직접 조이는 코드는 없다. OS keychain, Credential Manager, libsecret은 쓰지 않는다.

OS에 인증서를 신뢰시키는 `certutil` / `security add-trusted-cert` / `update-ca-certificates` 호출은 repo에서 찾지 못했다. UI(`src/routes/proxy/setup/index.tsx`)는 사용자가 인증서를 저장하고 설치했다고 체크하는 checklist다. PAC URL은 `http://127.0.0.1:{port}/.horizon-gateway/proxy.pac`이고, 인증서 다운로드 경로는 `local_proxy/reserved/paths.rs`의 `/.horizon-gateway/root.crt`다.

`save_root_ca`는 CLI 메타데이터상 `gui_only: true`이고, `dispatch_headless`는 `"gui_only: save_root_ca requires the Horizon Gateway GUI."`를 반환한다. 그런데 `settings_commands.rs`의 `save_root_ca_svc`는 PEM 문자열을 돌려줄 수 있고, GUI `GUI_ONLY_COMMANDS`에는 `save_root_ca`가 **없다.** 그래서 webview의 `commands.saveRootCa()`는 serve로 포워드된 뒤 에러가 난다. 파일 저장 다이얼로그를 여는 Rust 코드도 현재 트리에서 찾지 못했다. 이 동작은 분리 이전의 잔여로 보이며, headless에서 CA를 꺼내는 정식 API는 없다.

**6. 시스템 프록시(PAC)는 serve가 OS를 직접 만진다.**

`service/system_proxy_service.rs`의 `set_pac_url` / `clear_pac_url`. Windows는 HKCU `Internet Settings`, macOS는 `networksetup` (Wi-Fi, 실패 시 Ethernet). Linux는 빈 `Ok(())`다. proxy auto-start (`command/local_route_commands.rs`의 `auto_start_proxy`, `serve_loop`에서 spawn)가 이 함수를 호출한다.

**7. OS autostart는 구현되어 있지 않다.**

“auto-start”는 로그인 항목이 아니라 **serve가 뜰 때 proxy listener를 켜는 것**이다 (`auto_start_proxy`, `get_proxy_auto_start_error`). LaunchAgent, Windows Run 키, systemd user unit은 찾지 못했다.

**8. 로컬 바인딩은 두 층이다.**

- 제어 IPC: 항상 `127.0.0.1` 고정 포트. 끄는 스위치가 없다.
- 데이터 플레인 (proxy): `local_proxy/access/policy.rs`의 `listen_ip`. `ProxySettings.allow_remote_access`가 false(기본)면 `127.0.0.1`, true면 `0.0.0.0`이고 peer는 loopback 또는 private/CGNAT만 허용한다. non-loopback peer는 serve IPC 포트로 프록시하지 못한다 (`is_control_port`).

원격 attach용 토큰은 로컬 파일 하나다. 네트워크로 그 파일을 읽지 못하면 제어 API를 쓸 수 없다. roadmap이 말하는 “원격은 opt-in + token”과 현재의 “proxy만 opt-in, 제어 평면은 항상 loopback + 파일 토큰”은 다르다.

**9. `hgc` one-shot은 daemon과 상태가 갈라질 수 있다.**

포트가 닫혀 있으면 `hgc`가 `AppContext`를 직접 만든다. 그 사이 daemon이 없으면 디스크 JSON은 맞지만, 방금 등록한 mock은 프로세스 종료와 함께 메모리 룰 캐시가 아니라 디스크에 남고, **프록시는 뜨지 않는다.** 포트가 열려 있으면 IPC다. CI에서 “mock 등록 → 요청 → 캡처”를 하려면 one-shot이 아니라 살아 있는 `run_serve`가 필요하다.

**10. Frontend는 Tauri webview를 전제한다.**

`invoke`와 `listen` 외에 HTTP client로 core에 붙는 코드는 `src/`에서 찾지 못했다. `website/`는 마케팅 사이트다. dialog, fs, opener, notification, updater, deep-link, single-instance 플러그인은 GUI shell에만 있다.

**11. command 목록이 세 곳에 수동으로 있다.**

`cli/mod.rs`의 `CLI_COMMANDS`, 같은 파일의 `DISPATCHED_COMMAND_NAMES`, `dispatch_headless`의 match. `ServeCommand` trait는 `protocol.rs`에 있지만 dispatch는 trait object 테이블이 아니다. GUI-only로 표시된 채 serve에서 실패하는 이름: `save_root_ca`, `open_window`, `open_inspector_window`, `open_annotation_dialog` (`dispatch_headless`). 실제 창 command는 GUI `GUI_ONLY_COMMANDS`가 가로챈다. `save_root_ca`만 양쪽 어디에도 구현이 없다.

---

## 3. 목표 아키텍처

새 crate 이름을 지금 짓지 않는다. 오늘 `horizon-gateway-serve`가 이미 headless binary 자리다. 이름을 `core`로 바꾸는 것은 패키징·sidecar·skill 문자열을 한꺼번에 깨므로, 동작이 끝난 뒤의 리네임으로 미룬다.

```text
horizon-gateway-serve (daemon)
  proxy / mock / routes / monitor / storage / CA 서명
  control API + event stream
        ^
        | 같은 프로토콜
        +-- hgc (CLI, CI, agent)
        +-- hg-gui (Tauri shell + React)
        +-- 이후 web view (브라우저)
```

### Daemon

- 진입점: 오늘 `run_serve`. headless일 때는 tray event loop와 GUI spawn을 하지 않는다.
- 소유: `AppContext`가 가진 서비스, proxy listener, (opt-in일 때만) tunnel / transparent proxy.
- 기본 바인드: 제어 소켓은 loopback. 원격 listen은 명시적 플래그와 별도의 bearer가 있을 때만.
- 데이터 디렉터리: 지금처럼 `APP_IDENTIFIER` (`com.lurain.horizon-gateway`) 아래. 테스트·CI는 환경 변수로 루트를 바꿀 수 있어야 한다. **그런 변수는 현재 없다.** `resolve_app_data_dir`는 `dirs::data_dir()`만 본다.

### Client API

이미 있는 wire를 기준으로 고정하고, 전송만 나중에 넓힌다.

| 채널 | 오늘 | 목표 |
| :--- | :--- | :--- |
| 제어 | TCP, 줄 단위 JSON `ServeRequest` / `ServeResponse`. command는 문자열 | 같은 JSON. `protocol_version`을 서버가 실제로 검사. command는 `CLI_COMMANDS`에서 생성되는 목록 하나로 수렴 |
| 이벤트 | TCP, hello 후 NDJSON `ServeEvent` | 이벤트 이름을 `hg-core` 상수로 모으고, payload 타입을 모델과 같이 버전한다 |
| 발견 | 고정 `127.0.0.1:17345/17346` | `ServeEndpoints`를 실제로 기록. client는 파일(로컬) 또는 명시적 `--attach host:port` |
| 인증 | 로컬 `serve.token` 파일 | 로컬 파일 토큰은 loopback 기본값으로 유지. 비-loopback listen은 그 파일과 다른 토큰을 요구 |

Web view는 브라우저가 raw TCP를 열 수 없다. 선택지는 두 가지이고, 이 조사에서 구현을 고르지는 않는다.

- daemon이 loopback(또는 opt-in 주소)에 **얇은 HTTP/WebSocket 어댑터**를 두고, 내부는 기존 `dispatch_headless`를 호출한다.
- 또는 desktop만 TCP를 쓰고, web은 그 어댑터만 쓴다. `hgc`는 둘 중 안정된 쪽 하나를 쓴다.

roadmap의 열린 질문(“자체 프로토콜이냐, 처음부터 AHP/MCP냐”)에 대한 이 문서의 제안: **Phase 1 client API는 지금 NDJSON을 버전한 것으로 둔다.** MCP/AHP는 그 위의 어댑터다 (roadmap Phase 3). command 100개 가까운 match를 프로토콜 교체와 동시에 바꾸지 않는다.

### 누가 어떻게 붙나

- **`hgc`:** daemon이 있으면 IPC만 쓴다. one-shot in-process는 “daemon을 띄우지 않고 디스크만 만지는” 모드로 이름과 플래그를 분리한다. proxy를 건드리는 command (`start_local_proxy` 등)는 daemon이 없으면 실패하게 하는 편이 CI 의미가 분명하다. 당장은 동작을 바꾸지 말고, 플래그로 명시하는 PR에서 정한다.
- **Tauri shell:** 지금처럼 sidecar를 spawn하거나 attach한다 (`ensure_running`). webview의 `invoke`는 shell 안의 작은 adapter가 같은 client API로 바꾼다. React는 그 adapter 뒤에 둔다. OS 창, overlay, updater, deep link, single-instance는 shell에 남긴다.
- **Web view:** 새 앱. `src/`의 route를 그대로 재사용하려면 `invoke`/`listen`을 adapter로 바꿔야 한다. 그 전엔 web을 만들지 않는다.

### Shell에 남겨야 하는 OS 관심사

roadmap 문구와 코드를 대조하면 오늘 위치가 다르다. 목표 위치만 적는다.

| 관심사 | 오늘 | 목표 |
| :--- | :--- | :--- |
| 시스템 트레이 | `hg-serve/src/serve/tray.rs` | Tauri shell. core는 `serve-stopping` 같은 이벤트로 종료를 알리기만 한다 |
| CA 키 보관 | serve가 `ca/root.key` PEM, Unix 0600 | core가 서명에 쓴다. 키 파일은 데이터 디렉터리에 남기되 **export/import (`SettingsExport`)에는 계속 넣지 않는다** (`hg-core` `settings_export.rs` 주석이 이미 그렇게 말한다). OS keychain 이전은 이 계획의 필수 단계가 아니다. 코드에 keychain이 없다 |
| CA를 OS trust store에 설치 | 사용자 수동. 자동화 코드 없음 | shell(또는 OS별 helper)의 opt-in. headless는 PEM 출력과 “컨테이너에서 신뢰시키는 방법” 문서. core가 `certutil`을 기본으로 실행하지 않는다 |
| 로그인 시 autostart | 없음 | shell의 OS 설정 (있을 때). core는 자기가 떠 있는 동안 proxy auto-start만 담당 |
| 제어 평면 loopback | serve에 하드코드 | core의 기본값. shell은 “원격 허용” UI만 제공 |
| PAC / 시스템 프록시 | serve의 `SystemProxyService` | 데스크톱 shell로 옮긴다. Linux headless에서는 no-op인 오늘 동작을 문서화한다. 프록시 프로세스 자체는 core |
| WinDivert / admin | serve release manifest | transparent proxy helper만 승격. daemon 기본 binary는 `asInvoker` |
| 창, overlay, updater, deep link | `hg-gui` | 그대로 shell |

---

## 4. 점진적 이전

각 단계는 데스크톱 기본 동작을 유지한 채 합칠 수 있어야 한다. 프로토콜을 한 PR에서 갈아엎지 않는다.

### PR 1 — headless 프로세스 모드 (첫 추출)

가장 작은 유용한 변경이다. 로직을 새 crate로 옮기지 않는다. 이미 `hg-serve`에 있다.

- `horizon-gateway-serve`에 headless 스위치 하나를 추가한다. 예: `--headless` 또는 `HG_SERVE_HEADLESS=1`. 기본값은 꺼 둔다. 데스크톱 sidecar spawn (`hg-gui/src/serve/spawn.rs`)은 이 변수를 넣지 않는다.
- 켜져 있으면 `serve/server.rs`가 `tray::start()`를 호출하지 않고, 모든 OS에서 `accept_loop`가 프로세스를 살린다. `find_gui_exe` / GUI spawn을 하지 않는다.
- `ping`이 오늘과 같은 JSON을 반환하면 성공이다.
- 테스트: tray를 띄우지 않고 `run_serve` 동등 경로가 bind 되는지는, 지금 구조상 `serve_loop`가 포트를 고정하므로 기존 데스크톱 serve와 동시에 돌리기 어렵다. PR 1의 자동 테스트는 “플래그가 tray 분기를 건너뛰는지” 단위 테스트로 한정하고, 프로세스 기동은 수동 또는 기존 `scripts/smoke-serve-dual-attach.mjs` 전제(이미 serve가 떠 있음)를 깨지 않는 선에서 한다.

이 PR은 원격 바인드, 포트 변경, CA, manifest를 건드리지 않는다.

### PR 2 — CI에서 daemon + `hgc` 스모크

- Linux에서 `HG_SERVE_HEADLESS=1`로 serve를 띄우고, `hgc`로 mock rule을 만든 뒤 proxy 포트로 요청하고, `get_api_logs` 또는 기존 캡처 이벤트로 확인한다.
- 데이터 디렉터리가 호스트 머신 설정과 섞이지 않게, 이 PR에서 `resolve_app_data_dir`에 **테스트 전용 루트 override**를 넣는다. 이름과 기본값(미설정 시 오늘과 동일)은 구현 때 정한다. override 없이 CI를 돌리면 개발자 데이터 디렉터리를 오염시킨다.
- 실패하면 PR 1의 “컨테이너에서 tray 없이 살아 있는가”가 여기서 드러난다. 이 조사는 그 실행을 하지 않았다.

### PR 3 — `ServeEndpoints`를 실제로 쓰기

- `serve_loop`가 bind한 주소를 `ServeEndpoints`로 기록한다. 로컬 client (`hgc`, GUI)는 파일이 있으면 그 주소를, 없으면 오늘 상수로 fallback한다. fallback을 먼저 두면 구 serve와 신 client가 한동안 공존한다.
- 그 다음에 고정 포트 상수를 제거한다. `local_proxy/access/policy.rs`의 `is_control_port`도 기록된 포트를 보게 한다.
- `handle_client`가 `unsupported_version_error`를 적용하게 한다. 버전을 2로 올리는 작업은 별도다. 이 PR은 “검사하지 않던 필드를 검사”하는 쪽이므로, 필드가 없는 구 클라이언트가 default `1`로 역직렬화되는 동작(`protocol.rs` 테스트 `protocol_version_defaults_on_legacy_json`)을 유지한다.

### PR 4 — `save_root_ca`를 PEM 조회로 고치기

- `dispatch_headless`가 `save_root_ca_svc`를 호출해 PEM을 반환하게 한다. `gui_only` 에러를 제거한다.
- 파일 대화상자는 React + Tauri dialog (`src/shared/lib/tauri/saveDownload.ts`에 비슷한 패턴이 있다)로 shell에 둔다. core는 경로를 고르지 않는다.
- `hgc`로 PEM을 출력할 수 있으면 headless 문서의 전제가 성립한다. OS trust 자동화는 넣지 않는다.

### PR 5 — 시스템 통합을 shell로 옮기기

- PAC 설정 (`SystemProxyService`) 호출을 GUI command로 옮기고, serve의 `auto_start_proxy`는 listener만 연다. 데스크톱은 이벤트를 받아 shell이 PAC를 켠다. 회귀: 오늘 auto-start가 PAC까지 하므로, shell이 떠 있기 전에는 PAC가 바뀌지 않는다. release에서 serve가 GUI보다 먼저 PAC를 켜는 동작을 이 PR의 검증 항목으로 적는다.
- tray를 `hg-gui`로 옮긴다. serve 기본 경로는 PR 1 headless와 같아진다. 데스크톱은 shell이 tray를 가진다. macOS 메인 스레드 제약은 shell 프로세스에만 남는다.
- Windows: `requireAdministrator`를 transparent proxy를 켤 때만 쓰는 helper로 분리할 수 있는지 조사한다. 분리 방법이 불명확하면 daemon manifest는 이 PR에서 바꾸지 않고 리스크로 남긴다 (5장).

### PR 6 — React adapter

- `src/bindings.ts`의 `invoke`를 “Tauri면 기존 IPC forward, 나중엔 직접 client”인 한 모듈 뒤로 옮긴다. 이벤트 `listen`도 같다.
- specta로 `bindings.ts`를 다시 생성하지 않는다. 생성 경로가 현재 GUI command만 안다.
- 동작 변화 없이 데스크톱만 검증한다. web 번들은 만들지 않는다.

### PR 7 — 원격 attach (opt-in)

- 제어 소켓의 비-loopback bind는 플래그와 별도 토큰이 있을 때만.
- 파일 토큰을 네트워크에 노출하는 방식으로 원격 attach를 구현하지 않는다.
- 최소 web 페이지는 이 단계 이후다. adapter(PR 6)와 버전 검사(PR 3)가 먼저다.

PR 2의 스모크가 CI에서 초록이면 roadmap Phase 1의 “컨테이너에서 `hgc`로 mock → 요청 → 캡처”에 해당한다. “데스크톱이 내장 로직 없이 client로만 동작”은 이미 가깝고, PR 5–6이 남은 shell 결합을 걷는다. web view는 PR 7 다음이다.

---

## 5. 리스크와 열린 질문

### 리스크

- **이미 쪼개져 있다는 점을 무시하고 crate를 다시 나누는 일.** `hg-core` / `hg-serve` / `hg-gui` / `hgc`가 그 분할이다. 새 `core` crate로 파일을 옮기는 PR은 동작 이득 없이 sidecar 이름, `externalBin`, skill, `smoke:*` 스크립트를 깨뜨린다.
- **고정 포트.** `17345`/`17346`과 proxy 기본 `8888` (`hg-gui` `ensure.rs`의 `PROXY_PORT_PROBE`)이 호스트에 이미 있으면 headless 기동이 실패한다. `ServeEndpoints` 이전에는 인스턴스 하나를 전제한다. `smoke-serve-dual-attach.mjs`도 그 포트를 하드코드한다.
- **Windows admin manifest.** release daemon을 CI나 비관리자 계정에서 띄울 수 있는지는 이 환경에서 확인하지 않았다. debug는 `asInvoker`다.
- **tray event loop.** non-Windows headless가 `tao` 없이 안정적인지는 PR 1–2에서 확인해야 한다. 코드만으로는 DISPLAY 없는 서버에서 `EventLoop::run`이 실패하는지 알 수 없다.
- **`hgc` 이중 경로.** one-shot은 daemon의 메모리 상태(떠 있는 proxy, monitor 캐시)를 보지 않는다. 에이전트 문서가 “GUI 없이 된다”고만 하면 CI 시나리오와 어긋난다.
- **`save_root_ca` 회귀.** 위 2장의 경로대로면 데스크톱의 인증서 저장 버튼은 이미 serve에서 에러다. PR 4 전에 UI를 고친 것처럼 보이면 안 된다. 이 조사는 앱을 실행해 버튼을 누르지 않았다.
- **CA 키를 workspace export에 넣으면 안 된다.** `SettingsExport`가 이미 제외한다. 원격 attach나 이후 P2P에서도 키와 `serve.token`은 데이터 디렉터리 밖에 나가지 않아야 한다 (roadmap 보안 리스크와 같음).
- **bindings 재생성.** `bindings.ts`를 현재 `get_specta_builder`로 다시 뽑으면 backend command가 사라질 수 있다. client API 작업 중 codegen을 “정리”하지 않는다.
- **기능 범위.** chat, tunnel, USB, WinDivert가 같은 프로세스다. Phase 1 “core”를 proxy/mock만으로 정의하면 이 command들은 `dispatch_headless`에 그대로 남는다. 빼는 작업은 별도다.
- **Linux 시스템 프록시.** `SystemProxyService`는 Linux에서 성공만 반환한다. 컨테이너에서 “OS 프록시가 켜졌다”는 뜻으로 읽으면 안 된다.

### 코드만으로 확정하지 못한 것

- `docs/ROADMAP.md`는 조사 시점의 `main`에 머지되어 있지 않다. PR #10이 열린 draft다. Phase 순서나 문구가 바뀌면 이 문서의 “목표” 절을 다시 맞춰야 한다.
- headless Linux에서 현재 `horizon-gateway-serve`가 tray 때문에 죽는지, 포트만 열고 도는지 실행하지 않았다.
- `save_root_ca`가 예전 GUI 커밋에서는 dialog를 열었는지 git 이력으로 확인하지 않았다. 현재 트리에는 그 구현이 없다.
- OS 로그인 autostart는 없다. 제품이 그것을 요구하는지는 roadmap 문장(“autostart”)과 코드가 다르다. 구현 범위는 owner가 정해야 한다.
- 원격 client API를 HTTP로 둘지 TCP 위에 로컬 브리지를 둘지, 그리고 MCP를 Phase 1에 포함할지는 roadmap 7장과 같다. 이 문서는 Phase 1에서 MCP로 바꾸지 말 것을 제안할 뿐 결정이 아니다.
- `allow_remote_access`가 켜진 proxy와, 아직 loopback인 제어 평면을 web UI가 어떻게 같이 쓸지는 프로토콜 초안이 없다.
- Frontend를 `website/` Astro와 공유할지는 코드에 근거가 없다. `website/`는 마케팅 빌드(`pnpm web:build`)다.
- Supabase (Team / auth)는 이 분리의 데이터 플레인과 연결되어 보이지 않는다. `pnpm dev:gateway:tauri`가 로컬 Supabase를 띄운다는 `AGENTS.md` 설명은 있고, proxy core의 저장은 JSON 파일이다. Team 기능이 core daemon에 들어가야 하는지는 이 조사에서 결정하지 못했다.

### 테스트 전략 (제안)

오늘 있는 것: `hg-serve` 단위 테스트 (proxy, CA, protocol), `pnpm smoke:serve-dual-attach` (serve가 이미 떠 있어야 함), `smoke:chat-serve`, `smoke:session-handoff`. GUI 없는 “mock 등록 → 프록시 요청 → 로그” 잡 스크립트는 찾지 못했다.

PR 2가 그 스크립트를 추가하는 자리다. 데스크톱 회귀는 기존 smoke와 수동 확인으로 두고, headless 잡은 데이터 디렉터리 override가 생긴 뒤에만 CI에 넣는다.
