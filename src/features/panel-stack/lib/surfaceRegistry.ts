/**
 * Maps hub surface ids to lazy-loaded panels and detach sizes.
 * Register new overlay surfaces here; do not mount them ad hoc from routes.
 */
import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { HubSurfaceId } from "../types";

export type SurfaceTitleKey =
  | "infrastructure"
  | "settings"
  | "addDomain"
  | "manageGroups"
  | "profile"
  | "team"
  | "toolsPipeline"
  | "toolsCrypto"
  | "toolsPreview"
  | "toolsApiClient"
  | "toolsJsonSchema"
  | "toolsServerLogs"
  | "apiLogs"
  | "apiMocking"
  | "apiSchema"
  | "toolsApiLogs"
  | "toolsApiMocking"
  | "toolsApiSchema"
  | "toolsProxyGraph"
  | "toolsMonitor"
  | "toolsPolicies"
  | "toolsLiveCapture"
  | "toolsMonitorLogs";

export interface SurfaceRegistryEntry {
  id: HubSurfaceId;
  titleKey: SurfaceTitleKey;
  route: string;
  detachWidth: number;
  detachHeight: number;
  kind: "chrome" | "global";
  Component: LazyExoticComponent<ComponentType> | ComponentType;
}

const ChromeSettings = lazy(() =>
  import("../ui/surfaces/ChromeSettingsSurface").then((m) => ({ default: m.ChromeSettingsSurface })),
);
const ChromeTheme = lazy(() =>
  import("../ui/surfaces/ChromeThemeSurface").then((m) => ({ default: m.ChromeThemeSurface })),
);
const ChromeGroups = lazy(() =>
  import("../ui/surfaces/ChromeGroupsSurface").then((m) => ({ default: m.ChromeGroupsSurface })),
);
const ChromeAddDomain = lazy(() =>
  import("../ui/surfaces/ChromeAddDomainSurface").then((m) => ({ default: m.ChromeAddDomainSurface })),
);
const ChromeProfile = lazy(() =>
  import("../ui/surfaces/ChromeProfileSurface").then((m) => ({ default: m.ChromeProfileSurface })),
);
const ChromeTeam = lazy(() =>
  import("../ui/surfaces/ChromeTeamSurface").then((m) => ({ default: m.ChromeTeamSurface })),
);
const GlobalPipeline = lazy(() =>
  import("../ui/surfaces/GlobalPipelineSurface").then((m) => ({ default: m.GlobalPipelineSurface })),
);
const GlobalCrypto = lazy(() =>
  import("../ui/surfaces/GlobalCryptoSurface").then((m) => ({ default: m.GlobalCryptoSurface })),
);
const GlobalJsonSchema = lazy(() =>
  import("../ui/surfaces/GlobalJsonSchemaSurface").then((m) => ({ default: m.GlobalJsonSchemaSurface })),
);
const GlobalSchemaExplorer = lazy(() =>
  import("../ui/surfaces/GlobalSchemaExplorerSurface").then((m) => ({ default: m.GlobalSchemaExplorerSurface })),
);
const GlobalRoutePage = lazy(() =>
  import("../ui/surfaces/GlobalRoutePageSurface").then((m) => ({ default: m.GlobalRoutePageSurface })),
);
const GlobalProxyGraph = lazy(() =>
  import("../ui/surfaces/GlobalProxyGraphSurface").then((m) => ({ default: m.GlobalProxyGraphSurface })),
);
const GlobalMonitor = lazy(() =>
  import("../ui/surfaces/GlobalMonitorSurface").then((m) => ({ default: m.GlobalMonitorSurface })),
);
const GlobalPolicies = lazy(() =>
  import("../ui/surfaces/GlobalPoliciesSurface").then((m) => ({ default: m.GlobalPoliciesSurface })),
);

export const SURFACE_REGISTRY: Record<HubSurfaceId, SurfaceRegistryEntry> = {
  "chrome/infrastructure": {
    id: "chrome/infrastructure",
    titleKey: "settings",
    route: "/popup/settings",
    detachWidth: 860,
    detachHeight: 820,
    kind: "chrome",
    Component: ChromeSettings,
  },
  "chrome/settings": {
    id: "chrome/settings",
    titleKey: "settings",
    route: "/popup/settings",
    detachWidth: 860,
    detachHeight: 820,
    kind: "chrome",
    Component: ChromeSettings,
  },
  "chrome/theme": {
    id: "chrome/theme",
    titleKey: "settings",
    route: "/popup/theme",
    detachWidth: 720,
    detachHeight: 820,
    kind: "chrome",
    Component: ChromeTheme,
  },
  "chrome/groups": {
    id: "chrome/groups",
    titleKey: "manageGroups",
    route: "/popup/groups",
    detachWidth: 640,
    detachHeight: 600,
    kind: "chrome",
    Component: ChromeGroups,
  },
  "chrome/add-domain": {
    id: "chrome/add-domain",
    titleKey: "addDomain",
    route: "/popup/add-domain",
    detachWidth: 480,
    detachHeight: 520,
    kind: "chrome",
    Component: ChromeAddDomain,
  },
  "chrome/profile": {
    id: "chrome/profile",
    titleKey: "profile",
    route: "/profile",
    detachWidth: 520,
    detachHeight: 680,
    kind: "chrome",
    Component: ChromeProfile,
  },
  "chrome/team": {
    id: "chrome/team",
    titleKey: "team",
    route: "/team",
    detachWidth: 720,
    detachHeight: 820,
    kind: "chrome",
    Component: ChromeTeam,
  },
  "global/pipeline": {
    id: "global/pipeline",
    titleKey: "toolsPipeline",
    route: "/sandbox/pipeline",
    detachWidth: 1200,
    detachHeight: 800,
    kind: "global",
    Component: GlobalPipeline,
  },
  "global/crypto": {
    id: "global/crypto",
    titleKey: "toolsCrypto",
    route: "/sandbox/crypto",
    detachWidth: 960,
    detachHeight: 720,
    kind: "global",
    Component: GlobalCrypto,
  },
  "global/preview": {
    id: "global/preview",
    titleKey: "toolsPreview",
    route: "/sandbox/preview",
    detachWidth: 1100,
    detachHeight: 760,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/api-client": {
    id: "global/api-client",
    titleKey: "toolsApiClient",
    route: "/apis/client",
    detachWidth: 1200,
    detachHeight: 860,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/json-schema": {
    id: "global/json-schema",
    titleKey: "toolsJsonSchema",
    route: "/apis/json-schema",
    detachWidth: 1000,
    detachHeight: 760,
    kind: "global",
    Component: GlobalJsonSchema,
  },
  "global/server-logs": {
    id: "global/server-logs",
    titleKey: "toolsServerLogs",
    route: "/server-logs",
    detachWidth: 1000,
    detachHeight: 720,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/api-logs": {
    id: "global/api-logs",
    titleKey: "toolsApiLogs",
    route: "/apis/logs",
    detachWidth: 1200,
    detachHeight: 860,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/mocking": {
    id: "global/mocking",
    titleKey: "toolsApiMocking",
    route: "/apis/mocking",
    detachWidth: 1200,
    detachHeight: 860,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/schema-explorer": {
    id: "global/schema-explorer",
    titleKey: "toolsApiSchema",
    route: "/apis/schema",
    detachWidth: 1100,
    detachHeight: 800,
    kind: "global",
    Component: GlobalSchemaExplorer,
  },
  "global/proxy-graph": {
    id: "global/proxy-graph",
    titleKey: "toolsProxyGraph",
    route: "/proxy/connections",
    detachWidth: 1100,
    detachHeight: 780,
    kind: "global",
    Component: GlobalProxyGraph,
  },
  "global/monitor": {
    id: "global/monitor",
    titleKey: "toolsMonitor",
    route: "/monitor/manage",
    detachWidth: 960,
    detachHeight: 720,
    kind: "global",
    Component: GlobalMonitor,
  },
  "global/policies": {
    id: "global/policies",
    titleKey: "toolsPolicies",
    route: "/ux/policies",
    detachWidth: 1100,
    detachHeight: 760,
    kind: "global",
    Component: GlobalPolicies,
  },
  "global/live-capture": {
    id: "global/live-capture",
    titleKey: "toolsLiveCapture",
    route: "/ux/live-capture",
    detachWidth: 1100,
    detachHeight: 760,
    kind: "global",
    Component: GlobalRoutePage,
  },
  "global/monitor-logs": {
    id: "global/monitor-logs",
    titleKey: "toolsMonitorLogs",
    route: "/monitor/logs",
    detachWidth: 1100,
    detachHeight: 760,
    kind: "global",
    Component: GlobalRoutePage,
  },
};

export const GLOBAL_TOOL_SURFACES: HubSurfaceId[] = [
  "global/pipeline",
  "global/crypto",
  "global/preview",
  "global/api-client",
  "global/json-schema",
  "global/schema-explorer",
  "global/server-logs",
  "global/proxy-graph",
  "global/monitor",
  "global/policies",
  "global/live-capture",
];

export function getSurfaceEntry(id: HubSurfaceId): SurfaceRegistryEntry {
  return SURFACE_REGISTRY[id];
}
