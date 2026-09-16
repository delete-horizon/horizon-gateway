/**
 * Loads hub domain/group/proxy state from serve and keeps Jotai in sync.
 * Shared by the hub window; do not duplicate this subscription per panel.
 */
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { proxyActiveAtom } from "@/entities/app";
import type { DomainFeatureState } from "@/entities/domain";
import { domainsAtom } from "@/entities/domain";
import { apiLoggingLinksAtom } from "@/entities/domain-api-logging";
import { groupsAtom, linksAtom } from "@/entities/domain-group";
import { monitorLinksAtom } from "@/entities/domain-monitor";
import { localRoutesAtom } from "@/entities/proxy";
import type { Domain, ProxySettings } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import type { HubDataChangedReason } from "@/shared/lib/tauri/hubEvents";
import { useHubDataSubscription } from "../lib/hubDataSubscription";

/** Shared across all useDomainHubData() callers in the same window. */
const hubDataLoadingAtom = atom(false);
export const injectionDomainsAtom = atom<string[]>([]);
export const httpsDecryptHostsAtom = atom<string[]>([]);
export const hubProxySettingsAtom = atom<ProxySettings | null>(null);

export function useDomainHubData() {
  const [domains, setDomains] = useAtom(domainsAtom);
  const [groups, setGroups] = useAtom(groupsAtom);
  const [links, setLinks] = useAtom(linksAtom);
  const [monitorLinks, setMonitorLinks] = useAtom(monitorLinksAtom);
  const [apiLoggingLinks, setApiLoggingLinks] = useAtom(apiLoggingLinksAtom);
  const [injectionDomains, setInjectionDomains] = useAtom(injectionDomainsAtom);
  const [httpsDecryptHosts, setHttpsDecryptHosts] = useAtom(httpsDecryptHostsAtom);
  const [hubProxySettings, setHubProxySettings] = useAtom(hubProxySettingsAtom);
  const [localRoutes, setLocalRoutes] = useAtom(localRoutesAtom);
  const proxyActive = useAtomValue(proxyActiveAtom);
  const [loading, setLoading] = useAtom(hubDataLoadingAtom);

  const domainGroupIds = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const l of links) {
      map.set(l.domain_id, [...(map.get(l.domain_id) ?? []), l.group_id]);
    }
    return map;
  }, [links]);

  const monitorMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const m of monitorLinks) {
      map.set(m.domainId, m.checkEnabled);
    }
    return map;
  }, [monitorLinks]);

  const apiLoggingMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const a of apiLoggingLinks) {
      map.set(a.domainId, a.loggingEnabled ?? false);
    }
    return map;
  }, [apiLoggingLinks]);

  const proxyRouteMap = useMemo(() => {
    const map = new Map<number, { id: number; enabled: boolean; targetHost: string; targetPort: number }>();
    for (const r of localRoutes) {
      const domainId = r.domain_id;
      if (domainId != null && domainId > 0) {
        map.set(domainId, {
          id: r.id,
          enabled: r.enabled,
          targetHost: r.target_host,
          targetPort: r.target_port,
        });
      }
    }
    return map;
  }, [localRoutes]);

  const refreshByReason = useCallback(
    async (reason?: HubDataChangedReason) => {
      const needsAll = !reason;

      try {
        if (needsAll || reason === "domains") {
          const domainsRes = await commands.getDomains().then(unwrap);
          if (domainsRes.success) {
            setDomains(domainsRes.data ?? []);
          }
        }

        if (needsAll || reason === "groups") {
          const [groupsRes, linksRes] = await Promise.all([
            commands.getGroups().then(unwrap),
            commands.getDomainGroupLinks().then(unwrap),
          ]);
          if (groupsRes.success) {
            setGroups(groupsRes.data ?? []);
          }
          if (linksRes.success) {
            setLinks(linksRes.data ?? []);
          }
        }

        if (needsAll || reason === "features") {
          const [monitorRes, apiRes, injectionRes, settingsRes] = await Promise.all([
            commands.getDomainMonitorList().then(unwrap),
            commands.getDomainApiLoggingLinks().then(unwrap),
            commands.getInjectionDomains().then(unwrap),
            commands.getProxySettings().then(unwrap),
          ]);
          if (monitorRes.success) {
            setMonitorLinks(monitorRes.data ?? []);
          }
          if (apiRes.success) {
            setApiLoggingLinks(apiRes.data ?? []);
          }
          if (injectionRes.success) {
            setInjectionDomains(injectionRes.data ?? []);
          }
          if (settingsRes.success && settingsRes.data) {
            setHubProxySettings(settingsRes.data);
            setHttpsDecryptHosts(settingsRes.data.https_decrypt_hosts ?? []);
          }
        }

        if (needsAll || reason === "routes") {
          const routesRes = await commands.getLocalRoutes().then(unwrap);
          if (routesRes.success) {
            setLocalRoutes(routesRes.data ?? []);
          }
        }
      } catch (err) {
        console.error("useDomainHubData:", err);
      }
    },
    [
      setApiLoggingLinks,
      setDomains,
      setGroups,
      setHttpsDecryptHosts,
      setHubProxySettings,
      setInjectionDomains,
      setLinks,
      setLocalRoutes,
      setMonitorLinks,
    ],
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await refreshByReason();
    } finally {
      setLoading(false);
    }
  }, [refreshByReason, setLoading]);

  const handleHubDataChanged = useCallback(
    async (reason?: HubDataChangedReason) => {
      if (!reason) {
        await fetchAll();
        return;
      }
      await refreshByReason(reason);
    },
    [fetchAll, refreshByReason],
  );

  useHubDataSubscription(handleHubDataChanged);

  const getDomainHost = useCallback((domain: Domain) => {
    try {
      const u = new URL(domain.url.startsWith("http") ? domain.url : `https://${domain.url}`);
      return u.hostname.toLowerCase();
    } catch {
      return domain.url.toLowerCase();
    }
  }, []);

  const getFeatureState = useCallback(
    (domainId: number): DomainFeatureState => {
      const proxyRoute = proxyRouteMap.get(domainId);
      const domain = domains.find((d) => d.id === domainId);
      const host = domain ? getDomainHost(domain) : "";
      const scriptInjectionEnabled = Boolean(
        host && injectionDomains.some((item) => item.toLowerCase() === host || host.endsWith(`.${item.toLowerCase()}`)),
      );
      const httpsDecryptEnabled = Boolean(
        host &&
          httpsDecryptHosts.some((item) => item.toLowerCase() === host || host.endsWith(`.${item.toLowerCase()}`)),
      );

      return {
        monitorEnabled: monitorMap.has(domainId) ? monitorMap.get(domainId) : undefined,
        proxyEnabled: proxyRoute?.enabled,
        proxyRouteId: proxyRoute?.id,
        apiLoggingEnabled: apiLoggingMap.has(domainId) ? apiLoggingMap.get(domainId) : undefined,
        scriptInjectionEnabled,
        httpsDecryptEnabled,
      };
    },
    [apiLoggingMap, domains, getDomainHost, httpsDecryptHosts, injectionDomains, monitorMap, proxyRouteMap],
  );

  const getGroupName = useCallback(
    (domainId: number, noGroupLabel: string) => {
      const ids = domainGroupIds.get(domainId) ?? [];
      if (ids.length === 0) {
        return noGroupLabel;
      }
      const g = groups.find((x) => x.id === ids[0]);
      return g?.name ?? `Group #${ids[0]}`;
    },
    [domainGroupIds, groups],
  );

  const getGroupId = useCallback(
    (domainId: number) => {
      const ids = domainGroupIds.get(domainId) ?? [];
      return ids[0] ?? null;
    },
    [domainGroupIds],
  );

  const getProxyRoute = useCallback(
    (domain: Domain) => {
      return proxyRouteMap.get(domain.id);
    },
    [proxyRouteMap],
  );

  return {
    domains,
    groups,
    links,
    localRoutes,
    loading,
    proxyActive,
    domainGroupIds,
    fetchAll,
    getFeatureState,
    getGroupName,
    getGroupId,
    getDomainHost,
    getProxyRoute,
    hubProxySettings,
    setHubProxySettings,
    httpsDecryptHosts,
  };
}
