import {
  Activity,
  BookOpen,
  Bug,
  Cat,
  Code2,
  Download,
  FileCode,
  FolderTree,
  Globe,
  KeyRound,
  Layers,
  Network,
  Palette,
  Pencil,
  PlusCircle,
  Radio,
  Send,
  Server,
  Settings,
  Shield,
  Sliders,
  Trash2,
  Upload,
  User,
  Users,
  Wand2,
} from "lucide-react";
import type { PaletteCommandDef } from "../types";

export function createPaletteCommands(handlers: {
  getDomains: () => Promise<Array<{ id: number; url: string; name?: string }>>;
  getMockRules: () => Promise<Array<{ id: string; name: string; urlPattern: string }>>;
  getScenarios: () => Promise<Array<{ id: string; name: string; enabled: boolean }>>;
  onSelectDomain: (domainId: number) => void;
  onOpenDomainPanel: (domainId: number, panelId: string) => void;
  onEditMockRule: (ruleId: string) => void;
  onActivateScenario: (scenarioId: string) => Promise<void>;
  onToggleProxy: () => Promise<void>;
  onClearApiLogs: () => Promise<void>;
  onExportRootCa: () => Promise<void>;
  onOpenTeamSync: () => void;
  onOpenOverlayLab: () => void;
  onOpenAvatarStudio: () => void;
  onOpenThemeEditor: () => void;
  onOpenGlobalSurface: (surfaceId: string) => void;
  onOpenSettings: () => void;
  onExportAllSettings: () => Promise<void>;
  onImportAllSettings: () => Promise<void>;
  onSwitchTheme: (theme: string) => void;
  onSwitchLanguage: (lang: "ko" | "en") => void;
  onOpenBugReport?: () => void;
}): PaletteCommandDef[] {
  return [
    // --- [도메인] 영역 ---
    {
      id: "jump-domain",
      group: "domains",
      icon: <Globe className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도메인] 이동: 도메인 선택...", en: "[Domain] Jump to Domain..." },
        description: { ko: "등록된 도메인 선택 후 이동합니다", en: "Select a registered domain to jump to" },
        aliases: {
          ko: ["도메인", "이동", "열기", "찾기"],
          en: ["domain", "jump", "go", "open", "find"],
          common: ["HTTP", "HTTPS"],
        },
      },
      steps: [
        {
          id: "domainId",
          type: "autocomplete",
          prompt: { ko: "이동할 도메인을 선택하세요", en: "Select domain to navigate to" },
          placeholder: { ko: "도메인 이름 또는 URL 검색...", en: "Search domain name or URL..." },
          getOptions: async (query) => {
            const list = await handlers.getDomains();
            return list
              .filter(
                (d) =>
                  !query ||
                  d.url.toLowerCase().includes(query.toLowerCase()) ||
                  d.name?.toLowerCase().includes(query.toLowerCase()),
              )
              .map((d) => ({
                value: String(d.id),
                label: d.name || d.url,
                description: d.url,
                keywords: [d.url],
              }));
          },
        },
      ],
      action: (values) => {
        const id = Number(values.domainId);
        if (id) {
          handlers.onSelectDomain(id);
          return "Selected domain";
        }
      },
    },
    {
      id: "add-domain",
      group: "domains",
      icon: <PlusCircle className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도메인] 등록: 신규 도메인 추가", en: "[Domain] Add New Domain" },
        description: { ko: "새 API 도메인 등록 화면을 엽니다", en: "Open the add-domain form" },
        aliases: {
          ko: ["도메인", "등록", "추가", "신규"],
          en: ["domain", "add", "new", "create"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("chrome/add-domain");
      },
    },
    {
      id: "manage-domain-groups",
      group: "domains",
      icon: <FolderTree className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도메인] 관리: 그룹 편집", en: "[Domain] Manage Groups" },
        description: { ko: "도메인 카테고리 및 그룹 편성을 편집합니다", en: "Manage domain categories and groups" },
        aliases: {
          ko: ["도메인", "그룹", "카테고리", "관리"],
          en: ["domain", "group", "category", "manage"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("chrome/groups");
      },
    },
    {
      id: "open-domain-logs",
      group: "domains",
      icon: <Layers className="w-4 h-4 text-accent" />,
      meta: {
        label: { ko: "[도메인] 패널: API 로그...", en: "[Domain] View API Logs..." },
        description: {
          ko: "특정 도메인의 실시간 API 트래픽 로그를 확인합니다",
          en: "View API logs for a specific domain",
        },
        aliases: {
          ko: ["로그", "트래픽", "API", "패널"],
          en: ["logs", "traffic", "api", "panel"],
          common: ["API", "HTTP"],
        },
      },
      steps: [
        {
          id: "domainId",
          type: "autocomplete",
          prompt: { ko: "로그를 확인할 도메인을 선택하세요", en: "Select domain to view logs" },
          placeholder: { ko: "도메인 검색...", en: "Search domain..." },
          getOptions: async (query) => {
            const list = await handlers.getDomains();
            return list
              .filter((d) => !query || d.url.toLowerCase().includes(query.toLowerCase()))
              .map((d) => ({
                value: String(d.id),
                label: d.name || d.url,
                description: d.url,
              }));
          },
        },
      ],
      action: (values) => {
        const id = Number(values.domainId);
        if (id) {
          handlers.onOpenDomainPanel(id, "api/logs");
          return "Opened domain logs";
        }
      },
    },
    {
      id: "open-domain-mocking",
      group: "domains",
      icon: <Wand2 className="w-4 h-4 text-accent" />,
      meta: {
        label: { ko: "[도메인] 패널: 모킹 규칙...", en: "[Domain] View Mocking Rules..." },
        description: { ko: "선택한 도메인의 API 모킹 규칙 패널을 엽니다", en: "Open mocking rules for a domain" },
        aliases: {
          ko: ["모킹", "규칙", "가짜", "응답", "도메인"],
          en: ["mock", "rule", "fake", "response", "domain"],
        },
      },
      steps: [
        {
          id: "domainId",
          type: "autocomplete",
          prompt: { ko: "모킹 규칙을 열 도메인을 선택하세요", en: "Select domain for mock rules" },
          placeholder: { ko: "도메인 검색...", en: "Search domain..." },
          getOptions: async (query) => {
            const list = await handlers.getDomains();
            return list
              .filter((d) => !query || d.url.toLowerCase().includes(query.toLowerCase()))
              .map((d) => ({
                value: String(d.id),
                label: d.name || d.url,
                description: d.url,
              }));
          },
        },
      ],
      action: (values) => {
        const id = Number(values.domainId);
        if (id) {
          handlers.onOpenDomainPanel(id, "api/mocking");
          return "Opened mock rules";
        }
      },
    },
    {
      id: "open-domain-schema",
      group: "domains",
      icon: <FileCode className="w-4 h-4 text-accent" />,
      meta: {
        label: { ko: "[도메인] 패널: OpenAPI / Swagger 스키마...", en: "[Domain] View OpenAPI Schema..." },
        description: {
          ko: "선택한 도메인의 OpenAPI / Swagger 스키마 명세를 확인합니다",
          en: "View OpenAPI schema for a domain",
        },
        aliases: {
          ko: ["도메인", "스키마", "스웨거", "swagger", "openapi"],
          en: ["domain", "schema", "swagger", "openapi"],
        },
      },
      steps: [
        {
          id: "domainId",
          type: "autocomplete",
          prompt: { ko: "스키마를 확인할 도메인을 선택하세요", en: "Select domain to view schema" },
          placeholder: { ko: "도메인 검색...", en: "Search domain..." },
          getOptions: async (query) => {
            const list = await handlers.getDomains();
            return list
              .filter((d) => !query || d.url.toLowerCase().includes(query.toLowerCase()))
              .map((d) => ({
                value: String(d.id),
                label: d.name || d.url,
                description: d.url,
              }));
          },
        },
      ],
      action: (values) => {
        const id = Number(values.domainId);
        if (id) {
          handlers.onOpenDomainPanel(id, "api/schema");
          return "Opened domain schema";
        }
      },
    },

    // --- [프록시] & [보안] 영역 ---
    {
      id: "toggle-proxy",
      group: "proxy",
      icon: <Server className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[프록시] 토글: 로컬 프록시 서버 (ON/OFF)", en: "[Proxy] Toggle Local Proxy Server" },
        description: { ko: "로컬 트래픽 캡처 프록시를 시작하거나 중지합니다", en: "Start or stop local traffic proxy" },
        aliases: {
          ko: ["프록시", "서버", "시작", "중지", "토글", "켜기", "끄기"],
          en: ["proxy", "server", "toggle", "start", "stop"],
          common: ["HTTP", "HTTPS"],
        },
      },
      action: () => {
        handlers.onToggleProxy();
      },
    },
    {
      id: "view-proxy-graph",
      group: "proxy",
      icon: <Network className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[프록시] 분석: 라우팅 그래프 보기", en: "[Proxy] View Routing Graph" },
        description: {
          ko: "도메인 및 포트 간 실시간 트래픽 연결도를 시각화합니다",
          en: "Visualize proxy routing flow",
        },
        aliases: {
          ko: ["프록시", "그래프", "라우팅", "시각화", "흐름"],
          en: ["proxy", "graph", "routing", "flow"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/proxy-graph");
      },
    },
    {
      id: "export-root-ca",
      group: "proxy",
      icon: <Shield className="w-4 h-4 text-secondary" />,
      meta: {
        label: { ko: "[보안] 인증서: Root CA 내보내기", en: "[Security] Export Root CA Certificate" },
        description: {
          ko: "HTTPS 패킷 복호화용 Root CA 인증서를 내보냅니다",
          en: "Export Root CA for HTTPS interception",
        },
        aliases: {
          ko: ["인증서", "보안", "CA", "HTTPS", "SSL", "발급"],
          en: ["ca", "cert", "certificate", "ssl", "https", "security"],
        },
      },
      action: () => {
        handlers.onExportRootCa();
      },
    },

    // --- [모킹] 영역 ---
    {
      id: "find-mock-rule",
      group: "mocking",
      icon: <Wand2 className="w-4 h-4 text-warning" />,
      meta: {
        label: { ko: "[모킹] 편집: 규칙 검색 & 수정...", en: "[Mocking] Find & Edit Rule..." },
        description: { ko: "등록된 API 모킹 룰을 검색하고 편집합니다", en: "Search and edit mock rules" },
        aliases: {
          ko: ["모킹", "룰", "규칙", "검색", "수정", "편집"],
          en: ["mock", "rule", "search", "edit"],
        },
      },
      steps: [
        {
          id: "ruleId",
          type: "autocomplete",
          prompt: { ko: "수정할 모킹 룰을 선택하세요", en: "Select mock rule to edit" },
          placeholder: { ko: "패턴 또는 룰 이름 검색...", en: "Search pattern or rule name..." },
          getOptions: async (query) => {
            const list = await handlers.getMockRules();
            return list
              .filter(
                (r) =>
                  !query ||
                  r.name.toLowerCase().includes(query.toLowerCase()) ||
                  r.urlPattern.toLowerCase().includes(query.toLowerCase()),
              )
              .map((r) => ({
                value: r.id,
                label: r.name,
                description: r.urlPattern,
              }));
          },
        },
      ],
      action: (values) => {
        if (values.ruleId) {
          handlers.onEditMockRule(values.ruleId);
          return "Selected mock rule";
        }
      },
    },
    {
      id: "activate-scenario",
      group: "mocking",
      icon: <Wand2 className="w-4 h-4 text-warning" />,
      meta: {
        label: { ko: "[모킹] 실행: 테스트 시나리오 활성화...", en: "[Mocking] Activate Test Scenario..." },
        description: {
          ko: "미리 정의된 API 테스트 시나리오를 즉시 실행합니다",
          en: "Activate a pre-defined API scenario",
        },
        aliases: {
          ko: ["시나리오", "테스트", "실행", "활성화"],
          en: ["scenario", "test", "activate", "run"],
        },
      },
      steps: [
        {
          id: "scenarioId",
          type: "autocomplete",
          prompt: { ko: "활성화할 시나리오를 선택하세요", en: "Select scenario to activate" },
          placeholder: { ko: "시나리오 이름 검색...", en: "Search scenario name..." },
          getOptions: async (query) => {
            const list = await handlers.getScenarios();
            return list
              .filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()))
              .map((s) => ({
                value: s.id,
                label: s.name,
                description: s.enabled ? "Currently Active" : "Inactive",
              }));
          },
        },
      ],
      action: (values) => {
        if (values.scenarioId) {
          handlers.onActivateScenario(values.scenarioId);
          return "Scenario activated";
        }
      },
    },

    // --- [도구] 영역 ---
    {
      id: "open-api-client",
      group: "tools",
      icon: <Send className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도구] 실행: HTTP / API 클라이언트", en: "[Tool] Open API / HTTP Client" },
        description: {
          ko: "Postman 스타일 API 요청 테스터 도구를 실행합니다",
          en: "Open built-in Postman-style API tester",
        },
        aliases: {
          ko: ["도구", "클라이언트", "api", "http", "postman", "요청"],
          en: ["tool", "client", "api", "http", "postman", "send"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/api-client");
      },
    },
    {
      id: "open-crypto-tool",
      group: "tools",
      icon: <KeyRound className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도구] 실행: Crypto / JWT / Base64", en: "[Tool] Open Crypto & JWT Tool" },
        description: {
          ko: "JWT 디코더, Base64 및 SHA 암호화 유틸리티를 실행합니다",
          en: "Open JWT decoder, Base64 & hash tool",
        },
        aliases: {
          ko: ["도구", "jwt", "crypto", "base64", "암호화", "토큰", "복호화"],
          en: ["tool", "jwt", "crypto", "base64", "token", "hash"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/crypto");
      },
    },
    {
      id: "open-json-schema",
      group: "tools",
      icon: <Code2 className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도구] 실행: JSON Schema 검증기", en: "[Tool] Open JSON Schema Validator" },
        description: {
          ko: "JSON 구조 유효성 검사 및 스키마 생성기를 실행합니다",
          en: "Open JSON Schema validator and generator",
        },
        aliases: {
          ko: ["도구", "json", "schema", "검증", "유효성"],
          en: ["tool", "json", "schema", "validator"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/json-schema");
      },
    },
    {
      id: "open-pipeline-editor",
      group: "tools",
      icon: <Sliders className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[도구] 실행: 미들웨어 파이프라인 에디터", en: "[Tool] Open Middleware Pipeline Editor" },
        description: {
          ko: "HTTP 헤더 및 패킷 변환 파이프라인 룰을 작성합니다",
          en: "Open header transformation pipeline editor",
        },
        aliases: {
          ko: ["도구", "파이프라인", "미들웨어", "헤더", "변환"],
          en: ["tool", "pipeline", "middleware", "header", "transform"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/pipeline");
      },
    },

    // --- [로그] 영역 ---
    {
      id: "view-global-server-logs",
      group: "logs",
      icon: <Radio className="w-4 h-4 text-info" />,
      meta: {
        label: { ko: "[로그] 보기: 글로벌 프록시 통신 로그", en: "[Log] View Global Server Logs" },
        description: {
          ko: "전체 도메인의 통합 수신 트래픽 패킷 로그를 봅니다",
          en: "View unified proxy server packet logs",
        },
        aliases: {
          ko: ["로그", "통신", "트래픽", "서버", "패킷"],
          en: ["log", "server", "traffic", "packet"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/server-logs");
      },
    },
    {
      id: "view-global-health-monitor",
      group: "logs",
      icon: <Activity className="w-4 h-4 text-info" />,
      meta: {
        label: { ko: "[로그] 보기: 글로벌 헬스 모니터", en: "[Log] View Global Health Monitor" },
        description: {
          ko: "전체 도메인 헬스 상태 및 Latency 모니터링을 확인합니다",
          en: "View domain health and latency monitor",
        },
        aliases: {
          ko: ["로그", "모니터", "헬스", "상태", "응답속도", "latency"],
          en: ["log", "monitor", "health", "latency", "status"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/monitor");
      },
    },
    {
      id: "view-guides",
      group: "tools",
      icon: <BookOpen className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[가이드] 보기: UI/UX 가이드 관리", en: "[Guide] Manage UI/UX Guides" },
        description: {
          ko: "주입된 페이지 가이드를 내부 창에서 관리하고 리포트를 생성합니다",
          en: "Manage injection guides and generate reports in an in-app window",
        },
        aliases: {
          ko: ["가이드", "정책", "어노테이션", "리포트"],
          en: ["guide", "policy", "annotation", "report", "ux"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("global/policies");
      },
    },
    {
      id: "clear-api-logs",
      group: "logs",
      icon: <Trash2 className="w-4 h-4 text-error" />,
      meta: {
        label: { ko: "[로그] 삭제: API 패킷 로그 전체 삭제", en: "[Log] Clear All API Logs" },
        description: { ko: "오늘 저장된 API 패킷 캡처 기록을 전체 비웁니다", en: "Clear recorded API packet logs" },
        aliases: {
          ko: ["로그", "삭제", "비우기", "지우기", "초기화"],
          en: ["log", "clear", "delete", "empty"],
        },
      },
      action: () => {
        handlers.onClearApiLogs();
      },
    },

    // --- [설정] 영역 ---
    {
      id: "open-theme-editor",
      group: "settings",
      icon: <Palette className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[설정] 테마: 커스텀 테마 & 폰트 에디터", en: "[Settings] Custom Theme & Font Editor" },
        description: {
          ko: "컬러 팔레트 및 내 컴퓨터 폰트 설정 화면을 엽니다",
          en: "Open color palette and font customization panel",
        },
        aliases: {
          ko: ["테마", "폰트", "글꼴", "색상", "에디터", "설정", "커스텀"],
          en: ["theme", "font", "color", "palette", "editor", "custom"],
        },
      },
      action: () => {
        handlers.onOpenThemeEditor();
      },
    },
    {
      id: "open-settings",
      group: "settings",
      icon: <Settings className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[설정] 환경: 일반 프록시 & DNS 설정", en: "[Settings] Open Proxy & DNS Settings" },
        description: {
          ko: "프록시 포트, Reverse HTTP/HTTPS, DNS 설정을 엽니다",
          en: "Open proxy ports and DNS configuration",
        },
        aliases: {
          ko: ["설정", "포트", "dns", "환경설정", "프록시"],
          en: ["settings", "config", "port", "dns"],
        },
      },
      action: () => {
        handlers.onOpenSettings();
      },
    },
    {
      id: "export-all-settings",
      group: "settings",
      icon: <Download className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[설정] 백업: 전체 설정 JSON 내보내기", en: "[Settings] Export Backup JSON" },
        description: {
          ko: "등록 도메인, 모킹 룰, 프록시 설정을 JSON 파일로 백업합니다",
          en: "Export all domains and settings to JSON",
        },
        aliases: {
          ko: ["설정", "백업", "내보내기", "저장", "export"],
          en: ["settings", "backup", "export", "save"],
        },
      },
      action: () => {
        handlers.onExportAllSettings();
      },
    },
    {
      id: "import-all-settings",
      group: "settings",
      icon: <Upload className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[설정] 백업: 전체 설정 JSON 불러오기", en: "[Settings] Import Backup JSON" },
        description: {
          ko: "JSON 백업 파일에서 도메인 및 모킹 룰을 복원합니다",
          en: "Import domains and mock rules from JSON",
        },
        aliases: {
          ko: ["설정", "복원", "불러오기", "가져오기", "import"],
          en: ["settings", "restore", "import", "load"],
        },
      },
      action: () => {
        handlers.onImportAllSettings();
      },
    },
    {
      id: "switch-language",
      group: "settings",
      icon: <Globe className="w-4 h-4 text-slate-400" />,
      meta: {
        label: { ko: "[설정] 언어: 표시 언어 변경 (한국어 / English)...", en: "[Settings] Switch Language..." },
        description: { ko: "앱 표기 언어를 한국어 또는 영어로 설정합니다", en: "Set application display language" },
        aliases: {
          ko: ["언어", "한국어", "영어", "변경"],
          en: ["language", "korean", "english", "switch", "lang"],
        },
      },
      steps: [
        {
          id: "lang",
          type: "select",
          prompt: { ko: "설정할 언어를 선택하세요", en: "Select language" },
          options: [
            { value: "ko", label: "한국어 (Korean)" },
            { value: "en", label: "English" },
          ],
        },
      ],
      action: (values) => {
        if (values.lang === "ko" || values.lang === "en") {
          handlers.onSwitchLanguage(values.lang);
          return "Language updated";
        }
      },
    },

    // --- [팀] & [계정] 영역 ---
    {
      id: "open-team-sync",
      group: "team",
      icon: <Users className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[팀] 동기화: 팀 동기화 패널 열기", en: "[Team] Open Team Sync Panel" },
        description: { ko: "실시간 워크스페이스 팀 공유 패널을 엽니다", en: "Open real-time team workspace panel" },
        aliases: {
          ko: ["팀", "동기화", "공유", "협업"],
          en: ["team", "sync", "share", "collaboration"],
        },
      },
      action: () => {
        handlers.onOpenTeamSync();
      },
    },
    {
      id: "open-overlay-lab",
      group: "team",
      icon: <Cat className="w-4 h-4 text-amber-500" />,
      meta: {
        label: { ko: "[팀] 오버레이 실험실", en: "[Team] Overlay lab" },
        description: {
          ko: "로그인 없이 내 캐릭터와 말풍선을 시험합니다",
          en: "Try the edge character and bubbles without signing in",
        },
        aliases: {
          ko: ["오버레이", "실험실", "캐릭터", "말풍선", "playground"],
          en: ["overlay", "lab", "character", "bubble", "playground"],
        },
      },
      action: () => {
        handlers.onOpenOverlayLab();
      },
    },
    {
      id: "open-avatar-studio",
      group: "team",
      icon: <Pencil className="w-4 h-4 text-amber-500" />,
      meta: {
        label: { ko: "[팀] 아바타 스튜디오", en: "[Team] Avatar studio" },
        description: {
          ko: "24×24 파츠를 그리고 JSON으로 저장합니다",
          en: "Paint 24×24 parts and save them as JSON",
        },
        aliases: {
          ko: ["아바타", "파츠", "스튜디오", "픽셀", "스킨"],
          en: ["avatar", "parts", "studio", "pixel", "skin"],
        },
      },
      action: () => {
        handlers.onOpenAvatarStudio();
      },
    },
    {
      id: "open-profile",
      group: "team",
      icon: <User className="w-4 h-4 text-primary" />,
      meta: {
        label: { ko: "[계정] 프로필: 사용자 계정 및 Sponsors", en: "[Account] View Profile & Sponsors" },
        description: {
          ko: "계정 상태, 후원자 혜택 및 피드백 전송을 확인합니다",
          en: "View account profile and sponsors",
        },
        aliases: {
          ko: ["계정", "프로필", "후원", "sponsor", "profile"],
          en: ["account", "profile", "sponsor", "user"],
        },
      },
      action: () => {
        handlers.onOpenGlobalSurface("chrome/profile");
      },
    },
    {
      id: "open-bug-report",
      group: "team",
      icon: <Bug className="w-4 h-4 text-error" />,
      meta: {
        label: { ko: "[지원] 버그 리포트 & 피드백", en: "[Support] Bug Report & Feedback" },
        description: {
          ko: "화면 캡처와 함께 버그를 리포트하고 GitHub Issue를 생성합니다",
          en: "Capture screen and report bugs / create GitHub Issue",
        },
        aliases: {
          ko: ["버그", "리포트", "피드백", "깃허브", "이슈", "캡처", "문의", "에러", "스크린샷"],
          en: ["bug", "report", "feedback", "github", "issue", "capture", "screenshot", "error"],
        },
      },
      action: () => {
        handlers.onOpenBugReport?.();
      },
    },
  ];
}
