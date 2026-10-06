export const languages = {
  ko: "한국어",
  en: "English",
};

export const defaultLang = "ko";

export const ui = {
  ko: {
    "nav.home": "Home",
    "nav.changelog": "변경 이력",
    "hero.badge": "v2.8.14 릴리즈",
    "hero.title.pre": "당신의 로컬 개발 인프라를",
    "hero.title.post": "지키는 관측소, ",
    "hero.subtitle":
      "도메인 헬스체크, 로컬 MITM 프록시, API 모킹, UI/UX 가이드, 모바일 터널링까지. 개발 생산성을 극대화하기 위해 복잡한 인프라 도구를 단 하나의 데스크톱 앱으로 통합했습니다.",
    "hero.download.win": "Windows용 다운로드",
    "hero.download.mac": "macOS용 다운로드",
    "hero.download.all": "모든 설치 파일 보기",
    "hero.download.sub.win": "NSIS .exe (v2.8.14)",
    "hero.download.sub.mac": ".dmg · Apple Silicon & Intel (v2.8.14)",
    "hero.download.sub.all": "View All Installers",
    "features.title": "로컬 인프라 제어의 ",
    "features.title.accent": "핵심 기능",
    "features.subtitle": "Horizon Gateway 하나로 로컬 개발망 통제와 프록시 디버깅을 손쉽게 구성하세요.",
    "features.domain.title": "도메인 헬스체크",
    "features.domain.desc":
      "등록된 도메인의 상태를 실시간으로 모니터링합니다. 그룹화된 대시보드를 통해 주기적인 Ping 및 HTTP 코드를 체크하고 직관적으로 관리할 수 있습니다.",
    "features.proxy.title": "로컬 MITM 프록시",
    "features.proxy.desc":
      "HTTPS 트래픽 캡처를 지원하는 MITM 프록시 서버를 지원합니다. 특정 도메인의 요청을 로컬 개발 서버 포트나 지정 디렉토리로 강제 우회(Routing)시킵니다.",
    "features.api.title": "OpenAPI 및 모킹",
    "features.api.desc":
      "불러온 OpenAPI 스펙의 구조를 파악하고 모킹 규칙을 세부 정의합니다. 응답 헤더, 상태 코드, JSON 본문을 임의로 조작하여 클라이언트를 유연하게 테스트합니다.",
    "features.mobile.title": "UI/UX 가이드 & 모바일",
    "features.mobile.desc":
      "UI/UX 가이드를 관리하고 JSON으로 가져오거나 내보내며 PDF 리포트를 만듭니다. ADB 포트 포워딩과 터널링(Tailscale, Cloudflare)으로 모바일 기기를 연결합니다.",
    "features.mobile.connect": "ADB 연결",
    "features.mobile.tunnel": "터널 활성화",
    "terminal.badge": "AI 에이전트 통합",
    "terminal.title": "강력한 ",
    "terminal.title.accent": "CLI 명령어",
    "terminal.title.post": " 인터페이스",
    "terminal.desc":
      "Horizon Gateway는 GUI 외에도 전용 CLI 클라이언트(hgc)를 지원하여 Cursor, Gemini, Claude와 같은 AI 에이전트와 완벽하게 통합됩니다. 에이전트가 로컬 개발 서버와 도메인 구성을 직접 인지하고 제어하도록 만들어 보세요.",
    "perf.title": "Rust & Tauri 2 기반의 ",
    "perf.title.accent": "가벼움과 고성능",
    "perf.subtitle": "웹뷰 패키징의 무거움을 덜어내고 네이티브 수준의 속도와 안정성을 보장합니다.",
    "perf.installer.label": "초경량 인스톨러",
    "perf.installer.desc": "Electron 기반 앱 대비 빌드 용량을 90% 이상 절감하여 빠르게 다운로드하고 실행 가능합니다.",
    "perf.memory.label": "메모리 최적화",
    "perf.memory.desc":
      "Rust 백엔드가 OS 고유의 웹 렌더러를 활용하여 비동기 하이퍼 프록시 실행 시에도 메모리 점유율을 유지합니다.",
    "perf.startup.label": "즉시 시동 (Instant Start)",
    "perf.startup.desc":
      "실행 즉시 켜지는 첫 화면 속도와 비동기 Rust 스레드 아키텍처로 지연 시간 없는 인터페이스를 체감하세요.",
    "cta.title": "개발 흐름을 ",
    "cta.title.accent": "실시간",
    "cta.title.post": "으로 관측하세요",
    "cta.desc":
      "복잡한 터미널 프록시 도구, 모바일 연결 작업, 도메인 연결 모니터링을 Horizon Gateway가 하나로 통합해 드립니다. 지금 즉시 시도해 보세요.",
    "cta.btn": "최신 릴리즈 다운로드",
    "footer.desc":
      "로컬 개발 인프라 도메인 관리, MITM 프록시 패킷 분석 및 OpenAPI Mocking 기능을 통합하여 개발 효율성을 향상시킵니다.",
    "footer.license": "Copyright © 2026 규연. All rights reserved.",
    "changelog.subtitle": "Horizon Gateway의 최신 기능 추가 및 업데이트 이력입니다.",
    "gallery.title": "실제 앱의 ",
    "gallery.title.accent": "주요 기능",
    "gallery.subtitle": "Horizon Gateway의 핵심 기능들을 직접 살펴보세요. 도메인 모니터링부터 AI 통합까지, 모든 것이 하나의 앱에.",
    "gallery.tab.domains": "도메인 헬스",
    "gallery.tab.proxy": "프록시 연결",
    "gallery.tab.mocking": "API 모킹",
    "gallery.tab.setup": "프록시 설정",
    "gallery.tab.home": "홈",
    "gallery.domains.label": "모니터 대시보드",
    "gallery.proxy.label": "프록시 연결 맵",
    "gallery.mocking.label": "API 모킹 룰 수정",
    "gallery.setup.label": "설정 — 프록시",
    "gallery.home.label": "Horizon Gateway 홈",
    "terminal.shot.alt": "hgc init --project 와 get_domains를 실행한 터미널",
  },
  en: {
    "nav.home": "Home",
    "nav.changelog": "Changelog",
    "hero.badge": "v2.8.14 Release",
    "hero.title.pre": "The local dev-infra",
    "hero.title.post": "control center, ",
    "hero.subtitle":
      "Domain health checks, a local MITM proxy, API mocking, UI/UX guides, and mobile tunneling in one desktop app.",
    "hero.download.win": "Download for Windows",
    "hero.download.mac": "Download for macOS",
    "hero.download.all": "View All Releases",
    "hero.download.sub.win": "NSIS .exe (v2.8.14)",
    "hero.download.sub.mac": ".dmg · Apple Silicon & Intel (v2.8.14)",
    "hero.download.sub.all": "View All Installers",
    "features.title": "Core features of ",
    "features.title.accent": "Infra Control",
    "features.subtitle": "Easily control local development networks and proxy debugging with Horizon Gateway.",
    "features.domain.title": "Domain Health Check",
    "features.domain.desc":
      "Monitor the health of registered domains in real-time. Check Ping and HTTP status codes periodically on a grouped dashboard.",
    "features.proxy.title": "Local MITM Proxy",
    "features.proxy.desc":
      "An MITM proxy server that captures HTTPS traffic. Force route requests of specific domains to local dev server ports or specific directories.",
    "features.api.title": "OpenAPI & Mocking",
    "features.api.desc":
      "Inspect OpenAPI schema trees and define mocking rules. Manipulate headers, status codes, and JSON bodies to test clients flexibly.",
    "features.mobile.title": "UI/UX Guides & Mobile",
    "features.mobile.desc":
      "Manage UI/UX guides, import and export them as JSON, and generate a PDF report. Connect mobile devices with ADB port forwarding and tunnels (Tailscale, Cloudflare).",
    "features.mobile.connect": "ADB Connected",
    "features.mobile.tunnel": "Tunnel Active",
    "terminal.badge": "AI Agent Integration",
    "terminal.title": "Powerful ",
    "terminal.title.accent": "CLI Command",
    "terminal.title.post": " Interface",
    "terminal.desc":
      "Horizon Gateway supports a dedicated CLI client (hgc) for seamless integration with AI coding assistants like Cursor, Gemini, and Claude. Let AI agents control your local proxy routes and mocking directly.",
    "perf.title": "Rust & Tauri 2 Powered ",
    "perf.title.accent": "Light & Fast",
    "perf.subtitle": "Discard heavy webview packaging. Enjoy native-level speeds and resource footprint.",
    "perf.installer.label": "Ultra-light Installer",
    "perf.installer.desc":
      "Reduces installation package size by over 90% compared to Electron apps, making downloads and startup blazing fast.",
    "perf.memory.label": "Optimized Memory",
    "perf.memory.desc":
      "Rust backend utilizes OS-native web renderers, maintaining low memory usage even with asynchronous hyper-proxies running.",
    "perf.startup.label": "Instant Startup",
    "perf.startup.desc":
      "Experience instant-on app launches and lag-free interfaces driven by asynchronous Rust thread architectures.",
    "cta.title": "Observe your dev flow in ",
    "cta.title.accent": "Real-time",
    "cta.title.post": "",
    "cta.desc":
      "Horizon Gateway unifies complex terminal proxies, mobile debugging, and health monitors into one app. Try it right now.",
    "cta.btn": "Download Latest Release",
    "footer.desc":
      "Boost development efficiency by unifying local domain health monitoring, MITM proxy analysis, and OpenAPI mocking.",
    "footer.license": "Copyright © 2026 Gyuyeon. All rights reserved.",
    "changelog.subtitle": "Version history and release notes for Horizon Gateway.",
    "gallery.title": "Explore ",
    "gallery.title.accent": "Key Features",
    "gallery.subtitle": "See Horizon Gateway's core capabilities in action — from domain monitoring to AI agent integration, all in one app.",
    "gallery.tab.domains": "Domain Health",
    "gallery.tab.proxy": "Proxy Connections",
    "gallery.tab.mocking": "API Mocking",
    "gallery.tab.setup": "Proxy Setup",
    "gallery.tab.home": "Home",
    "gallery.domains.label": "Monitor Dashboard",
    "gallery.proxy.label": "Proxy Connections",
    "gallery.mocking.label": "API Mocking — Edit Rule",
    "gallery.setup.label": "Settings — Proxy",
    "gallery.home.label": "Horizon Gateway home",
    "terminal.shot.alt": "Terminal running hgc init --project and get_domains",
  },
} as const;

export type Lang = keyof typeof ui;
