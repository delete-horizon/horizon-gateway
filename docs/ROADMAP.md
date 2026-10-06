# horizon-gateway Roadmap

- 작성일: 2026-10-06
- 상태: Draft (owner 검토용)
- 범위: 다음 3단계의 제품·아키텍처 방향. 일정은 확정하지 않고, 단계별 "done when" 기준으로 진행 여부를 판단한다.

---

## 1. horizon-gateway는 지금 무엇인가

horizon-gateway는 **Tauri 2 (Rust) + React** 기반의 데스크톱 앱이다. 현재 제공하는 기능은 다음과 같다.

- **로컬 HTTPS MITM proxy**: 로컬 root CA로 트래픽을 가로채고 관찰한다.
- **API mocking**: OpenAPI 기반 mock 포함.
- **Domain health-check 기반 routing**: 도메인 상태에 따라 요청을 로컬 또는 원격으로 보낸다.
- **`hgc` CLI**: AI 에이전트가 위 기능들을 직접 조작할 수 있게 해 주는 CLI.

지금 구조는 "사람이 데스크톱 앱을 쓰고, 에이전트는 `hgc`로 같은 앱을 조작한다"이다. 이 구조는 데스크톱 GUI가 있는 머신을 전제로 하기 때문에, cloud나 CI에서 돌아가는 에이전트는 쓸 수 없다. 또 "AI가 조작하는 proxy/mock"이라는 현재 포지션은 경쟁 제품들이 빠르게 따라잡았다(2장 참고). 이 두 가지 이유로 방향을 바꾼다.

---

## 2. Why now: 시장에서 확인한 것

아래 내용은 2026-10-06에 작성한 별도의 시장 조사 보고서(로컬 우선·P2P·에이전트+사람 워크스페이스 landscape, 출처 약 60개)를 요약한 것이다. 보고서 자체는 이 repo 밖에 있다.

1. **현재 제품 영역은 레드오션이 되고 있다.** Proxyman은 내장 MCP 서버(도구 약 40개)를 제공하고, HTTP Toolkit은 2026-04에 공식 MCP와 `httptoolkit-ctl` CLI를 출시했다. "에이전트가 조작할 수 있는 mock/proxy"는 이제 기본 사양이다. 이것만으로는 차별화가 되지 않는다.
2. **"에이전트와 사람이 동등한 로컬 P2P 도구"라는 메시지는 이미 쓰이고 있다.** Canopy(⭐301, P2P mesh, agent = human)와 Happy desktop(⭐87, "Local-first · Peer-to-peer first")이 거의 같은 표현을 쓴다. 카테고리는 생겼지만 승자는 아직 없다. 다만 빈 니치라고 보기는 어렵다.
3. **대형 플랫폼은 "사람+에이전트 공유 세션"을 기본 기능으로 흡수하고 있다.** Cursor Self-Hosted Machines, VS Code Agent Host + AHP(2026-08 공개된 오픈 프로토콜), Claude Code Agent Teams, GitHub Agent HQ, Tailscale Aperture가 그 예다. 세션 공유 자체는 차별점이 될 수 없다.
4. **남아 있는 빈자리**는 두 가지가 겹치는 곳이다.
   - **개발 환경 상태(dev-environment state)** 공유: routing 규칙, mock, OpenAPI, 캡처된 트래픽, 연결된 디바이스와 터널을 팀원의 머신과 그들의 에이전트에 공유하는 것.
   - 로컬에서 **에이전트의 network egress를 관찰하고 통제**하는 것.

   이 조합을 앞세운 제품은 찾지 못했다. 단, 이것은 "조사 범위 안에서 찾지 못했다"는 뜻이지 존재하지 않는다는 증명은 아니다.
5. **수요 신호는 강한 것과 약한 것이 섞여 있다.**
   - 강함: 로컬 에이전트 세션을 원격이나 다른 기기에서 보고 제어하려는 수요. Happy 모바일 클라이언트 ⭐24k, T3 Code ⭐25.7k.
   - 약함: "멀티 에이전트 + P2P" 자체에 대한 수요. 개발자 설문에서 68%가 단일 에이전트 구성을 선호했다([Stack Overflow, 2026-05-27](https://stackoverflow.blog/2026/05/27/agents-on-a-leash-agentic-ai-remains-mostly-monitored-at-work/)). 같은 설문에서 human-in-the-loop(승인과 통제)에 대한 요구는 강하게 나타났다.

**결론:** P2P는 헤드라인이 될 수 없다. 니치이지만 가치가 높은 부가 레이어로 다룬다. 헤드라인이 되어야 하는 것은 두 가지다. 하나는 "어디서든(CLI/cloud) 돌아가는 core"이고, 다른 하나는 "에이전트가 한 일을 사람이 보고 통제하는 layer"다.

---

## 3. 포지셔닝

**Primary**

> **사람과 에이전트가 함께 쓰는 local-first 개발 환경. 에이전트가 내 네트워크와 API에 무엇을 하는지 사람이 관찰하고 통제하는 human-in-the-loop layer를 제공한다.**

"AI가 조작하는 MITM/mock 도구"(레드오션)에서 위 포지션으로 옮겨 간다. 차별점은 mock 기능 자체가 아니라 **에이전트가 만든 mock과 테스트를 사람이 한눈에 보고 승인하거나 되돌릴 수 있다는 점**이다.

**Fallback** (primary가 먹히지 않을 경우)

> **로컬 agent egress 관찰·기록 도구.** 기존 MITM 위에서 에이전트가 내보내는 트래픽(LLM API, 원격 MCP, 외부 API)을 세션 단위로 기록하고 재현한다.

현재 기능에서 가장 가까운 방향이라 전환 비용이 적다. Phase 1–2의 산출물을 대부분 그대로 쓸 수 있다.

---

## 4. Phased Roadmap

순서는 **① core/view 분리 → ② workspace 단위 상태 + 관찰 view → ③ P2P 공유**다.

### 왜 P2P가 1순위가 아닌가

- ①과 ②만으로도 "CLI/cloud에서 돌아가는 사람+에이전트 dev 환경"이라는 포지션이 성립한다. P2P가 없어도 사용자가 얻는 가치가 있다.
- P2P와 CRDT는 공유할 **단위(workspace)**와 붙을 **core(headless 서버)**가 먼저 있어야 깔끔하게 얹힌다. 순서를 거꾸로 하면 데스크톱 앱 내부 상태 구조에 sync를 억지로 끼워 넣게 된다.
- 수요 신호상 P2P는 니치다. 기술 복잡도(NAT 통과, 키 관리, 권한 회수, CRDT 위의 권한 모델)와 보안 부담은 가장 크다. 비용이 가장 큰 작업을 검증된 수요가 가장 약한 곳에 먼저 쓰지 않는다.

---

### Phase 1: Headless core / View 분리

**목표:** `hgc` core를 GUI 없이 단독 서버로 실행할 수 있게 만든다. 데스크톱과 웹 view는 이 core에 attach하는 client가 된다. VS Code Agent Host / AHP가 가는 방향("세션 core 하나, client 여러 개")에 맞춘다. 이 흐름과 싸우지 않고 올라탄다.

**Workstreams**
- **Core 추출:** proxy, mock, routing, health-check 로직을 Tauri 앱에서 분리해 독립 Rust 바이너리(headless daemon)로 만든다. 데스크톱 앱은 이 core를 띄우거나, 이미 떠 있는 core에 붙는다.
- **Client API 정의:** core와 client 사이에 명시적인 API(제어 + 이벤트 스트림)를 둔다. 데스크톱 view, 웹 view, `hgc` CLI가 모두 같은 API를 쓴다. 이 API는 Phase 3에서 MCP/AHP/ACP로 노출할 때의 기반이 되므로 처음부터 versioning한다.
- **Web view:** 원격 core(cloud VM, CI runner, 다른 머신)에 붙어서 볼 수 있는 최소 web client를 만든다.
- **CLI/cloud 테스트 가능성:** Linux 컨테이너와 CI에서 core를 띄우고 `hgc`로 시나리오를 실행하는 경로를 공식 지원한다. root CA 설치·신뢰 절차를 headless 환경에 맞게 문서화한다.
- **인증 기본값:** core는 기본적으로 localhost에만 바인딩한다. 원격 attach는 명시적으로 켜야 하고 token이 필요하다.

**Done when**
- GUI가 없는 Linux 컨테이너에서 core를 띄우고, `hgc`만으로 mock 등록 → 요청 → 캡처 확인까지 하는 시나리오가 CI에서 돌아간다.
- 데스크톱 앱이 내장 로직 없이 core client로만 동작하고, 기존 기능에 회귀가 없다.
- 원격 core에 web view로 붙어서 트래픽과 mock 상태를 볼 수 있다.

---

### Phase 2: Workspace 단위 상태 + Mocking/Testing 관찰 View

**목표:** 흩어져 있는 환경 상태를 **workspace**라는 하나의 단위로 묶는다. 그 위에 "에이전트가 무엇을 mock하고 무엇을 테스트했는지"를 사람이 보고 통제하는 view를 만든다. 이 view가 제품의 핵심 차별점이다.

**Workstreams**
- **Workspace 모델:** routing 규칙, mock 세트, OpenAPI 스펙, 캡처 세션, 연결된 디바이스와 터널 설정을 하나의 workspace로 묶는다. 저장 포맷을 정의하고 export/import를 지원한다. 이 모델은 Phase 3에서 CRDT 문서로 옮길 수 있게 설계한다. 예를 들어 객체 단위 ID를 두고, 변경을 operation 단위로 기록한다.
- **Actor 기록:** 모든 변경에 "누가(사람 / 어떤 에이전트 / 어떤 client) 언제 무엇을" 했는지 남긴다. 사람과 에이전트가 같은 객체를 조작하되 출처는 구분한다.
- **Mocking/Testing 관찰 view:** 다음을 보여 준다.
  - 에이전트가 추가하거나 수정한 mock과 routing 규칙 목록
  - 에이전트가 실행한 테스트 요청과 결과
  - 각 항목의 출처(actor)와 변경 이력
- **Human-in-the-loop 통제:** 에이전트의 변경을 승인, 거부, 되돌리기(revert)할 수 있게 한다. 정책 모드를 선택할 수 있다(예: 자동 적용 / 승인 후 적용). Ink & Switch Patchwork의 "봇이 제안하고 사람이 diff를 리뷰하는" 모델을 참고한다.
- **Agent egress 관찰 (fallback 포지션의 기반):** 에이전트 프로세스의 트래픽을 세션 단위로 묶어 기록하고 재현한다. 처음에는 "관찰과 기록" 중심으로 하고, 차단이나 마스킹 같은 정책은 그 다음으로 미룬다.

**Done when**
- workspace 하나를 export해서 다른 머신(또는 CI)에 import하면 같은 mock, routing, OpenAPI 상태가 재현된다.
- 에이전트가 `hgc`로 만든 mock과 테스트가 view에 actor와 함께 표시되고, 사람이 그 자리에서 승인, 거부, revert할 수 있다.
- 에이전트 세션 하나의 egress 트래픽을 기록하고 다시 재생할 수 있다.

---

### Phase 3: P2P 공유 + 표준 프로토콜 노출

**목표:** Phase 2의 workspace를 팀원의 머신과 그들의 에이전트에 P2P로 동기화한다. `hgc`를 업계 표준 프로토콜로 노출해 어떤 에이전트 하네스에서든 쓸 수 있게 한다. 이 단계는 **부가 레이어**다. 없어도 Phase 1–2만으로 제품이 성립해야 한다.

**Workstreams**
- **CRDT:** workspace 모델을 Automerge 또는 Loro(둘 다 Rust)로 옮긴다. 둘을 비교한 뒤 하나를 고른다. 비교 기준은 문서 크기, 히스토리 관리, 권한 모델을 얹기 쉬운지 여부다. "CRDT만으로는 부족하다"는 점을 전제로 하고 다음 문제를 별도로 설계한다.
  - 권한(누가 어떤 객체를 수정할 수 있나)
  - 스냅샷과 부트스트랩
  - 충돌의 의미 수준 처리(예: 같은 경로에 mock이 두 개 생기는 경우)
- **P2P 전송:** Iroh(Rust, 1.0)로 키 기반 연결, NAT 홀펀칭, relay fallback을 구현한다. 초대(invite) 링크로 공유를 시작하고, 피어별 권한 회수(revocation)를 지원한다.
- **첫 유스케이스:** "동료가 재현한 버그 상태(mock 세트 + routing + 캡처 트래픽)를 링크 하나로 내 머신과 내 에이전트에 복제" 또는 "내 에이전트가 만든 mock 변경을 동료가 실시간으로 리뷰하고 승인". 일반적인 실시간 협업보다 이 좁은 시나리오를 먼저 완성한다.
- **표준 노출:**
  - `hgc`를 MCP 서버로 1급 노출하고 공식 MCP Registry 등록을 검토한다.
  - VS Code AHP와 Zed/JetBrains ACP와 붙을 수 있는지 검토한다.
  - 명령을 그대로 1:1 노출하기보다 에이전트용 고수준 워크플로로 묶는 편을 우선한다.

**Done when**
- 서로 다른 네트워크에 있는 두 머신이 invite 링크로 workspace를 공유하고, 한쪽 에이전트의 변경이 다른 쪽 view에 actor와 함께 나타난다.
- 공유를 철회하면 해당 피어가 더 이상 변경을 받거나 보낼 수 없다.
- 최소 하나의 주요 에이전트 하네스에서 MCP로 `hgc` 워크플로를 쓸 수 있다.

---

## 5. Risks

| 리스크 | 내용 | 대응 |
|---|---|---|
| **플랫폼 흡수** | Cursor, Microsoft(VS Code Agent Host + AHP, GitHub Agent HQ), Anthropic(Claude Code Agent Teams), Tailscale(Aperture)이 "로컬 실행 + 공유 + 조정"의 일부를 기본 기능으로 넣고 있다. 특히 AHP가 오픈 표준으로 자리 잡으면 "세션 공유"는 차별점이 되지 못한다. | 세션 공유로 경쟁하지 않는다. AHP/MCP/ACP 위에 올라타는 **환경 레이어**로 남는다. Phase 1의 client API를 표준과 맞물리게 설계한다. |
| **Cloud agent로의 이동** | 업계 내러티브가 "에이전트는 클라우드에서 돈다"로 가고 있다. 추론은 원래 클라우드 API이므로 "로컬"의 가치는 도구 실행과 데이터 경계로 좁혀진다. | Phase 1의 headless core가 이 리스크에 대한 대응이다. core가 cloud와 CI에서도 돌아가면, 에이전트가 어디서 돌든 같은 환경과 관찰 레이어를 쓸 수 있다. "local-first"는 로컬 전용이라는 뜻이 아니라 로컬이 기본값이라는 뜻으로 쓴다. |
| **보안 표면 확대** | 로컬 MITM의 root CA, 원격 attach, P2P 노출, 에이전트의 proxy 조작 권한이 겹치면 공격 표면이 커진다. 2026년에는 MCP STDIO command-injection(RCE), tool poisoning 같은 사고가 보고됐다([OX Security advisory](https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/)). | core는 기본 localhost 바인딩과 token 인증을 쓴다. 원격 기능과 P2P는 모두 opt-in이다. 에이전트 권한 범위를 명시한다. CA 키를 공유 workspace에 넣지 않는다. Phase 3 공개 전에 위협 모델 문서를 작성한다. 보안은 잘 풀면 차별점이지만 잘못 풀면 치명적이다. |
| **같은 메시지의 선점** | Canopy와 Happy가 이미 "P2P, 동등한 에이전트" 메시지를 쓴다. | 주어를 "대화/세션"이 아닌 "**개발 환경**"으로 둔다. |
| **CRDT/P2P 복잡도** | 권한, 부트스트랩, 오프라인 UX, relay 운영, 키 관리는 소규모 유지보수 체제에 부담이다. | Phase 3로 미루고 좁은 유스케이스부터 시작한다. Iroh 같은 성숙한 라이브러리를 쓴다. |

---

## 6. Non-goals: 의도적으로 경쟁하지 않는 것

- **채팅 앱이 아니다.** 사람+에이전트 채널이나 메시징(Canopy, Happy desktop, Solo 영역)은 만들지 않는다.
- **에이전트 하네스가 아니다.** 에이전트를 실행하고 조정하는 일(Cursor, Claude Code, Codex, VS Code, T3 Code 영역)은 그들에게 맡긴다. horizon-gateway는 그 에이전트들이 **함께 들여다보고 조작하는 환경**이다.
- **멀티 에이전트 오케스트레이션 프레임워크가 아니다.**
- **Proxyman/HTTP Toolkit과 기능 수 경쟁을 하지 않는다.** 차별점은 기능 개수가 아니라 관찰·통제 레이어와 workspace 공유에 있다.
- **엔터프라이즈 중앙 AI gateway가 아니다.** Tailscale Aperture 같은 중앙 프록시 모델은 목표가 아니다. 대상은 개인과 소규모 팀의 로컬 환경이다.

---

## 7. 열린 질문

- Automerge와 Loro 중 무엇을 쓸지 (Phase 3 착수 전에 spike로 결정)
- Phase 1 client API를 자체 프로토콜로 둘지, 처음부터 AHP/MCP 형태에 맞출지
- Primary 포지셔닝의 성패를 판단할 신호를 무엇으로 정의할지 (예: Phase 2 view 사용 여부, workspace export/import 사용 빈도)
