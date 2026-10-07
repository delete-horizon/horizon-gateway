# 기획: 수익화 뼈대 & 상용 마감 (v2.6 ~ v2.8)

> 작성일: 2026-07-17 · 대상 제품: **Horizon Gateway** · 회사: **Delete Horizon**
> 범위: (2) 수익화·B2B로 이어지는 최소 뼈대, (3) 상용 판매 전 신뢰(마감)
> 제외: iframe Core Protocol (별도 앱/플랫폼 전략 문서로 분리)

---

## 0. 배경 / 문제 정의

현재(v2.5.4) 상태:

- 인증(Supabase + GitHub OAuth), GitHub Sponsors, Early Access Labs, 피드백(Supabase 저장), 딥링크까지 구현됨.
- 그러나 **후원 → 혜택 반영이 수동**이고, **사용 데이터 근거가 없으며**, **상용 마감(오류 처리 일관성)** 이 아직 부족.

전략 전제(합의됨):

- **B2C = 로컬·저비용 → 사용자·피드백 확보 엔진** (서버비 거의 0)
- **B2B = 회사 예산 → 실질 매출** (팀 공유·정책·지원)
- 후원은 **진짜 후원**: 금액 무관, 모든 후원자에게 **Early Access + 뱃지** 동일 제공
- 기존 기능은 **무제한 유지**, 신규/부가에서 수익화

이 문서는 위 전략을 코드로 옮기기 위한 **가장 작은 실행 단위**를 정의한다.

---

## 1. 목표 (Goals)

| # | 목표 | 성공 기준 |
|---|------|-----------|
| G1 | 후원 상태 자동 반영 | GitHub Sponsors 후원 시, 사용자 조작 없이 `is_sponsor`가 갱신되고 앱에서 Labs 해제 |
| G2 | 사용 데이터 확보 (opt-in) | 익명 telemetry로 "어떤 기능이 실제로 켜지는지" 집계 (민감정보 미수집) |
| G3 | 피드백 → 개발 파이프 연결 | 앱 피드백이 버전/OS 메타와 함께 쌓이고, 개발자가 GitHub Issue로 전환 가능 |
| G4 | 팀 공유의 전 단계 | 설정·도메인·mock 규칙을 **파일로 export/import** (파일럿에서 즉시 사용) |
| G5 | 상용 마감 | `alert()` 제거 → 일관된 토스트/모달, 앱 전역 ErrorBoundary, MITM 온보딩 가이드 |

**비목표(Non-Goals)**: 결제/구독 시스템, Team 서버 동기화, SSO, 라이선스 키 — 이번 범위 아님(후속).

---

## 2. 현재 코드 기준선 (Baseline)

| 영역 | 현재 상태 | 근거 |
|------|-----------|------|
| 후원 상태 | 프로필 생성 시 `is_sponsor: false` 하드코딩, 이후 갱신 로직 없음 | `src/entities/app/bootstrap.ts:205` |
| 프로필 스키마 | `DBProfile { is_sponsor, sponsor_tier }` 존재 | `src/entities/app/user/store.ts:51-59` |
| Labs 플래그 | 로컬 `atomWithStorage` 2종, Sponsor 게이팅은 UI에서 처리 | `store.ts:64-70`, `routes/profile/index.tsx:320` |
| 피드백 | `feedbacks` 테이블에 `content`만 insert, 메타 없음 | `routes/profile/index.tsx:48-63` |
| telemetry | 없음 | — |
| export/import | 설정·UX 정책 일부만 존재, 도메인·mock 통합 export 없음 | `features/popup-window/ui/SettingsContent.tsx`, `routes/ux/policies/index.tsx` |
| 오류 표시 | `alert()` 15개 파일 산재, 토스트/ErrorBoundary 없음 | grep: `alert(` × 15 files |

---

## 3. 범위 상세

### 3.1 G1 — Sponsor 자동 동기화

**목적**: "후원했는데 앱은 그대로"인 경험 제거.

**설계 (택1, A 우선)**

- **A. GitHub Sponsors Webhook → Supabase Edge Function → `profiles.is_sponsor` 갱신** (권장)
  - Sponsors 이벤트(`sponsorship` created/cancelled/tier_changed) 수신
  - GitHub login/id로 `profiles` 매칭 → `is_sponsor`, `sponsor_tier`, `sponsor_since` 업데이트
  - 매칭 키: OAuth 시 저장한 GitHub `user_name`/`id`를 프로필에 보관 필요
- **B. 앱 시작 시 서버가 Sponsors GraphQL로 조회** (보조/백필)

**필요 변경**
- `profiles`에 `github_login`(또는 `github_id`) 컬럼 추가 + OAuth 메타에서 저장 (`bootstrap.ts` 프로필 생성부)
- Edge Function + Sponsors webhook secret
- 앱은 기존 `supabaseProfileAtom.is_sponsor`만 신뢰 (클라 변경 없음에 가깝게)

**수용 기준**
- [ ] 테스트 후원 계정으로 후원 → 1분 내 앱 재조회 시 Labs 해제
- [ ] 후원 취소 → 다음 세션에 잠금 복귀
- [ ] 매칭 실패 시 로그 + 수동 백필 경로 존재

---

### 3.2 G2 — 익명 Telemetry (opt-in)

**원칙**: 기본 **OFF**, 설정에서 명시적 동의. 로컬 우선 제품 신뢰 유지.

**절대 수집 금지**: 도메인 URL, 요청/응답 바디·헤더, mock 내용, 인증서, 파일 경로, IP.

**수집 예시 (개수·불리언·enum만)**
- 앱 버전, OS/아치
- 익명 `install_id`(로컬 UUID)
- 기능 활성 여부: 프록시 on/off, mocking on/off, inspector on/off
- 규모 버킷: 도메인 수(구간), mock 규칙 수(구간) — **원본 수 대신 버킷**
- 세션 heartbeat(DAU/주간 활성 추정용)

**설계**
- `telemetryEnabledAtom`(로컬), 최초 실행 시 1회 안내
- 전송: Supabase `events` 테이블 또는 경량 엔드포인트, 실패 시 조용히 무시
- 배치·쓰로틀 (앱 시작/기능 토글 시)

**수용 기준**
- [ ] 동의 전에는 어떤 이벤트도 전송되지 않음(네트워크 확인)
- [ ] payload에 민감 필드가 구조적으로 들어갈 수 없음(타입으로 강제)
- [ ] 설정에서 끄면 즉시 중단 + install_id 재생성 옵션

---

### 3.3 G3 — 피드백 파이프 강화

**현재**: `feedbacks`에 `content`만. 재현 정보 없음.

**변경**
- insert payload에 자동 첨부: 앱 버전, OS, (동의 시) install_id, 화면/기능 컨텍스트, 카테고리(bug/feature/question)
- 개발자용: Supabase 피드백 → **GitHub Issue 전환**(수동 버튼 또는 Edge Function). 민감정보는 비공개 유지.
- 앱 "문의하기"에서 카테고리 선택 → bug/feature는 공개 Issue 유도 가능, B2B/보안은 이메일 안내

**수용 기준**
- [ ] 새 피드백에 버전/OS 메타 포함
- [ ] 카테고리 필드 저장
- [ ] (개발자) 피드백 1건을 GitHub Issue로 전환하는 경로 존재

---

### 3.4 G4 — Export / Import (팀 공유 전 단계)

**목적**: Team 서버 동기화 이전에, **파일 기반 공유**로 파일럿(예시 B2C FE) 즉시 활용.

**대상**
- 도메인 + 그룹
- mock 규칙 / 시나리오
- (선택) OpenAPI 소스, 프록시/라우팅 설정
- 기존 설정·정책 export 로직과 통합/일관화

**포맷**
- 단일 `.hg.json` 번들: `{ schemaVersion, exportedAt, app: "horizon-gateway", data: {...} }`
- import 시 스키마 버전 확인 + 충돌 처리(덮어쓰기/병합 선택)
- 민감정보(토큰 등) export 제외 또는 마스킹

**수용 기준**
- [ ] 도메인+그룹+mock을 한 파일로 export
- [ ] 다른 PC에서 import 후 동일 구성 재현
- [ ] 버전 불일치 시 명확한 안내(무음 실패 금지)

---

### 3.5 G5 — 상용 마감

**5-1. `alert()` 제거 → 토스트/모달 통일**
- 공용 토스트 시스템 도입(성공/오류/정보), 확인성 액션은 기존 `ConfirmModal` 유지
- 대상 15개 파일: `policies`(6), `CreateMockModal`(5), `SettingsContent`(5), `mobile`(4), `PipelineLibraryPanel`(4), `TopBar`(3), `json-schema`(3), `CryptoNode`(3), `live-capture`(2), 그 외(1)
- i18n(ko/en) 메시지 일관화

**5-2. 전역 ErrorBoundary**
- 루트(`src/main.tsx` / `__root.tsx`)에 ErrorBoundary + 패널/서페이스 단위 경계
- 오류 시: 앱 크래시 대신 복구 UI + (동의 시) 오류 리포트 전송 옵션

**5-3. MITM 온보딩 가이드**
- Root CA 생성·설치 스텝별 가이드(플랫폼별), 성공 확인 체크
- 유료·팀 전환의 최대 이탈 지점 완화

**수용 기준**
- [ ] `alert(` 사용 0건(코드 grep)
- [ ] 렌더 오류 시 화이트스크린 없이 복구 UI
- [ ] 신규 사용자가 가이드만 보고 HTTPS 캡처 성공 가능

---

## 4. 로드맵 / 마일스톤

```
v2.6  G5-1 토스트 통일 + G5-2 ErrorBoundary        (상용 마감 선행)
v2.7  G4 export/import + G3 피드백 메타/카테고리     (파일럿 즉시 효용)
v2.8  G1 Sponsor 자동 동기화 + G2 telemetry(opt-in) + G5-3 MITM 가이드
```

순서 근거: **마감(G5)** 은 다른 기능의 품질 기반이므로 먼저. **G4/G3** 은 파일럿에서 바로 쓰여 피드백을 만든다. **G1/G2** 는 서버 작업(Edge Function/스키마)이 있어 마지막.

---

## 5. 데이터/스키마 변경 요약

| 테이블 | 변경 |
|--------|------|
| `profiles` | `github_login`(또는 `github_id`), `sponsor_since` 추가 |
| `feedbacks` | `app_version`, `os`, `category`, `install_id`(nullable), `context` 추가 |
| `events` (신규) | `install_id`, `app_version`, `os`, `event`, `props(jsonb)`, `ts` |

RLS: `events`/`feedbacks`는 insert 허용·조회 제한. `profiles.is_sponsor`는 **서버(Edge Function)만 갱신**.

---

## 6. 리스크 / 유의

- **개인정보/신뢰**: telemetry는 opt-in·민감정보 불가가 핵심. 문구·기본값 신중히.
- **Sponsors 매칭 실패**: GitHub login 미저장 사용자 백필 경로 필요.
- **export 민감정보 유출**: 토큰/인증서 제외 규칙 테스트 필수.
- **B2B 혼선 방지**: Sponsors=개인 후원, 세금계산서·팀 결제는 별도(후속 문서).

---

## 7. 후속(이번 범위 밖)

- 결제/구독(MoR: Lemon Squeezy/Paddle) + 국내 세금계산서
- Team 서버 동기화·워크스페이스·정책 배포·감사 로그(B2B Business)
- iframe Core Protocol (별도 플랫폼 전략)

---

## 8. 오픈 퀘스천

- [ ] Sponsor 매칭 키: GitHub `login` vs `id` 중 무엇을 정본으로?
- [ ] telemetry 저장소: Supabase 테이블 vs 외부 경량 수집기?
- [ ] export 번들에 프록시/라우팅 설정까지 포함할지(민감도)?
- [ ] 피드백 → GitHub Issue 전환을 자동 vs 개발자 수동으로?
