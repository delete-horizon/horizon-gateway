import { matchHostPattern, matchPathPattern } from "./pattern";

export type GuideMatchFields = {
  hostPattern?: string | null;
  domain?: string | null;
  pathPattern?: string | null;
  url?: string | null;
};

export type RegisteredHost = {
  host: string;
};

export type GuideHostCoverageStatus = "ok" | "none";

export type GuideHostCoverage = {
  status: GuideHostCoverageStatus;
  matchedHosts: string[];
  unmatchedHosts: string[];
};

export const GUIDE_HOST_FILTER_ALL = "ALL";

export function isAllGuideHostFilter(selected: string): boolean {
  return selected.trim() === "" || selected.trim().toUpperCase() === GUIDE_HOST_FILTER_ALL;
}

/** Exact hostname only — substring `includes` matches `bp-www.example.dev` for seed `www.example.dev`. */
export function resolveGuideHostFilterSeed(seed: string, hosts: readonly string[]): string {
  const normalized = seed.trim().toLowerCase();
  if (!normalized) {
    return GUIDE_HOST_FILTER_ALL;
  }
  const exact = hosts.find((host) => host.trim().toLowerCase() === normalized);
  return exact ?? normalized;
}

export function guideMatchesHostFilter(
  ann: GuideMatchFields,
  selectedHost: string,
  options?: { unmatched?: boolean; unmatchedStatus?: GuideHostCoverageStatus },
): boolean {
  if (options?.unmatched) {
    return options.unmatchedStatus === "none";
  }
  if (isAllGuideHostFilter(selectedHost)) {
    return true;
  }
  return annotationMatchesHost(ann, selectedHost.trim().toLowerCase());
}

/**
 * Apply a guide by hostPattern. `domain` is capture origin only —
 * used as a legacy fallback when hostPattern is empty.
 */
export function annotationMatchesHost(ann: GuideMatchFields, actualHost: string): boolean {
  const pattern = ann.hostPattern?.trim() ? ann.hostPattern : null;
  return matchHostPattern(pattern, pattern ? null : ann.domain, actualHost);
}

export function annotationMatchesPage(ann: GuideMatchFields, actualHost: string, actualPath: string): boolean {
  return annotationMatchesHost(ann, actualHost) && matchPathPattern(ann.pathPattern, ann.url, actualPath);
}

export function resolveGuideHostCoverage(ann: GuideMatchFields, registered: RegisteredHost[]): GuideHostCoverage {
  const unique = new Set<string>();
  for (const item of registered) {
    const host = item.host.trim().toLowerCase();
    if (host) {
      unique.add(host);
    }
  }
  const hosts = Array.from(unique).sort();
  if (hosts.length === 0) {
    return { status: "ok", matchedHosts: [], unmatchedHosts: [] };
  }
  const matchedHosts = hosts.filter((host) => annotationMatchesHost(ann, host));
  const unmatchedHosts = hosts.filter((host) => !matchedHosts.includes(host));
  return {
    status: matchedHosts.length === 0 ? "none" : "ok",
    matchedHosts,
    unmatchedHosts,
  };
}
