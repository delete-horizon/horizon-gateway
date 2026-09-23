import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { Globe, Keyboard } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom, openWorkspaceCompanion, usePromiseModal } from "@/entities/app";
import type { DomainFeatureState } from "@/entities/domain";
import type { Domain } from "@/shared/api";
import { useIsDetachedWindow } from "@/shared/lib/tauri/useEmbedMode";
import { ErrorBoundary } from "@/shared/ui/error-boundary";
import { useDomainHubData } from "../hooks/useDomainHubData";
import { usePanelNavigation } from "../hooks/usePanelNavigation";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import { copyTextToClipboard, formatSelectedDomainUrls } from "../lib/bulkSelection";
import { domainListBulkAnchorIdAtom } from "../lib/bulkSelectionAtoms";
import { HubOverlayProvider } from "../lib/HubOverlayContext";
import type { HandoffTarget } from "../lib/hubHandoff";
import { canOpenPanel } from "../lib/panelGates";
import {
  collapsedPanelsAtom,
  domainListBulkModeAtom,
  domainListBulkSelectedIdsAtom,
  domainListBulkSnapshotAtom,
  domainListFilteredIdsAtom,
  domainListOverlayOpenAtom,
  domainListPinnedOpenAtom,
  hubHandoffRemoteTargetAtom,
  manualExpandedPanelsAtom,
  panelOverlayOpenAtom,
} from "../store";
import type { HubSurfaceId, PanelEntry } from "../types";
import { DisabledPanel } from "./DisabledPanel";
import { DomainApiLogDetailPanel } from "./DomainApiLogDetailPanel";
import { DomainApiLogsPanel } from "./DomainApiLogsPanel";
import { DomainApiMockingPanel } from "./DomainApiMockingPanel";
import { DomainApiPanel } from "./DomainApiPanel";
import { DomainApiSchemaPanel } from "./DomainApiSchemaPanel";
import { DomainBulkManagePanel } from "./DomainBulkManagePanel";
import { DomainDebugPanel } from "./DomainDebugPanel";
import { DomainListPanel } from "./DomainListPanel";
import { DomainMonitorPanel } from "./DomainMonitorPanel";
import { DomainOverviewPanel } from "./DomainOverviewPanel";
import { DomainProxyPanel } from "./DomainProxyPanel";
import { HubContextBar } from "./HubContextBar";
import { HubSurfaceOverlay } from "./HubSurfaceOverlay";
import { PanelBreadcrumb } from "./PanelBreadcrumb";
import { TopBar } from "./TopBar";

function getDomainLabel(domain: Domain) {
  try {
    const u = new URL(domain.url.startsWith("http") ? domain.url : `https://${domain.url}`);
    return u.hostname;
  } catch {
    return domain.url;
  }
}

interface HubPanelWrapperProps {
  panel: PanelEntry;
  domain: Domain;
  features: DomainFeatureState | null;
  panelIndex: number;
  panels: PanelEntry[];
  nav: ReturnType<typeof usePanelNavigation>;
  hostFilter: string;
}

function HubPanelWrapper({ panel, domain, features, panelIndex, panels, nav, hostFilter }: HubPanelWrapperProps) {
  const onClose = () => {
    if (panel.id === "overview" && panels.length === 1) {
      nav.clearDomain();
      return;
    }
    nav.closePanel(panelIndex);
  };

  const disabled = panel.id !== "overview" && panel.id !== "debug" && (!features || !canOpenPanel(panel.id, features));

  if (disabled) {
    return <DisabledPanel key={`${panel.id}-disabled`} panelId={panel.id} domain={domain} onClose={onClose} />;
  }

  const renderPanelContent = () => {
    switch (panel.id) {
      case "overview":
        return (
          <DomainOverviewPanel
            key="overview"
            domain={domain}
            onClose={onClose}
            onOpenPanel={(id, params) => nav.openPanel(id, params)}
            activePanelIds={panels.map((p) => p.id)}
          />
        );
      case "monitor":
        return <DomainMonitorPanel key="monitor" domain={domain} onClose={onClose} />;
      case "proxy":
        return <DomainProxyPanel key="proxy" domain={domain} onClose={onClose} />;
      case "api":
        return (
          <DomainApiPanel
            key="api"
            domain={domain}
            onClose={onClose}
            onOpenPanel={(id) => nav.openPanel(id)}
            activeSection={panels.find((p) => p.id.startsWith("api/") && p.id !== "api/log")?.id}
          />
        );
      case "api/logs":
        return (
          <DomainApiLogsPanel
            key="api/logs"
            domain={domain}
            onClose={onClose}
            onSelectLog={(logId) => nav.openPanel("api/log", { logId })}
            selectedLogId={panels.find((p) => p.id === "api/log")?.params?.logId}
          />
        );
      case "api/log":
        return (
          <DomainApiLogDetailPanel
            key={`api/log-${panel.params?.logId}`}
            logId={panel.params?.logId ?? ""}
            domainId={domain.id}
            hostFilter={hostFilter}
            onClose={onClose}
          />
        );
      case "api/mocking":
        return <DomainApiMockingPanel key="api/mocking" domain={domain} onClose={onClose} />;
      case "api/schema":
        return <DomainApiSchemaPanel key="api/schema" domain={domain} onClose={onClose} />;
      case "debug":
        return <DomainDebugPanel key="debug" domain={domain} onClose={onClose} />;
      default:
        return null;
    }
  };

  return <ErrorBoundary fallbackTitle={`Panel error (${panel.id})`}>{renderPanelContent()}</ErrorBoundary>;
}

export function DomainHubPage() {
  const nav = usePanelNavigation();
  const isDetachedSurface = useIsDetachedWindow();
  const [remoteHandoffTarget, setRemoteHandoffTarget] = useAtom(hubHandoffRemoteTargetAtom);

  useEffect(() => {
    if (!remoteHandoffTarget) {
      return;
    }

    const target: HandoffTarget = remoteHandoffTarget;
    setRemoteHandoffTarget(null);

    if (target.scope === "domain") {
      nav.openPanelForDomain(target.domainId, target.panelId);
      return;
    }
    if (target.surfaceId === "chrome/team") {
      nav.closeGlobalSurface();
      void openWorkspaceCompanion();
      return;
    }
    nav.openGlobalSurface(target.surfaceId);
  }, [remoteHandoffTarget, nav, setRemoteHandoffTarget]);

  const { domains, loading, getDomainHost, getFeatureState } = useDomainHubData();
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const { alert: showAlert } = usePromiseModal();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hubOverlayRef = useRef<HTMLDivElement>(null);
  const [bulkMode, setBulkMode] = useAtom(domainListBulkModeAtom);
  const [bulkSnapshot, setBulkSnapshot] = useAtom(domainListBulkSnapshotAtom);
  const setBulkSelectedIds = useSetAtom(domainListBulkSelectedIdsAtom);
  const setBulkAnchorId = useSetAtom(domainListBulkAnchorIdAtom);
  const store = useStore();
  const [manualExpanded, setManualExpanded] = useAtom(manualExpandedPanelsAtom);
  const [domainListOverlayOpen, setDomainListOverlayOpen] = useAtom(domainListOverlayOpenAtom);
  const [panelOverlayOpen, setPanelOverlayOpen] = useAtom(panelOverlayOpenAtom);
  const [, setDomainListPinnedOpen] = useAtom(domainListPinnedOpenAtom);
  const bulkHydratedRef = useRef(false);
  const manualExpandedRef = useRef(manualExpanded);
  manualExpandedRef.current = manualExpanded;

  const [showShortcutTip, setShowShortcutTip] = useState(false);
  const [, setCollapsedPanels] = useAtom(collapsedPanelsAtom);
  const tipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const navRef = useRef(nav);
  navRef.current = nav;
  const overlayStateRef = useRef({
    domain: false,
    panel: null as string | null,
    global: false,
    bulk: false,
  });
  overlayStateRef.current = {
    domain: domainListOverlayOpen,
    panel: panelOverlayOpen,
    global: nav.globalSurface != null,
    bulk: bulkMode,
  };
  const prevDomainIdRef = useRef<number | null>(null);

  const triggerShortcutTip = useCallback(() => {
    setShowShortcutTip(true);
    if (tipTimerRef.current) {
      clearTimeout(tipTimerRef.current);
    }
    tipTimerRef.current = setTimeout(() => {
      setShowShortcutTip(false);
    }, 3000);
  }, []);

  const launchWorkspaceApp = useCallback(() => {
    void openWorkspaceCompanion().then((error) => {
      if (error) {
        void showAlert(t.errorGeneric, error, "warning");
      }
    });
  }, [showAlert, t]);

  const openSurface = useCallback(
    (id: HubSurfaceId) => {
      if (id === "chrome/team") {
        launchWorkspaceApp();
        nav.closeGlobalSurface();
        return;
      }
      if (bulkMode) {
        void showAlert(t.errorGeneric, t.bulkBlocksGlobal, "warning");
        return;
      }
      nav.openGlobalSurface(id);
    },
    [bulkMode, launchWorkspaceApp, nav, showAlert, t],
  );

  const openTeamWorkspace = useCallback(() => {
    if (bulkMode) {
      void showAlert(t.errorGeneric, t.bulkBlocksGlobal, "warning");
      return;
    }
    nav.closeGlobalSurface();
    launchWorkspaceApp();
  }, [bulkMode, launchWorkspaceApp, nav, showAlert, t]);

  const domain = nav.domainId ? domains.find((d) => d.id === nav.domainId) : null;
  const domainFeatures = domain ? getFeatureState(domain.id) : null;

  const enterBulkMode = useCallback(() => {
    if (nav.domainId != null) {
      setBulkSnapshot({ domainId: nav.domainId, panels: nav.panels });
      nav.clearDomain();
    }
    setBulkMode(true);
  }, [nav, setBulkMode, setBulkSnapshot]);

  const exitBulkMode = useCallback(() => {
    const snapshot = bulkSnapshot;
    setBulkMode(false);
    setBulkSelectedIds(new Set());
    setBulkAnchorId(null);
    setBulkSnapshot(null);
    if (snapshot?.domainId != null) {
      nav.restoreNavigation(snapshot.domainId, snapshot.panels);
    }
  }, [bulkSnapshot, nav, setBulkAnchorId, setBulkMode, setBulkSelectedIds, setBulkSnapshot]);

  const [copied, setCopied] = useState(false);
  const domainsRef = useRef(domains);
  domainsRef.current = domains;
  const exitBulkModeRef = useRef(exitBulkMode);
  exitBulkModeRef.current = exitBulkMode;

  useEffect(() => {
    if (!bulkMode || bulkHydratedRef.current) {
      return;
    }
    bulkHydratedRef.current = true;
    if (nav.domainId != null && bulkSnapshot === null) {
      setBulkSnapshot({ domainId: nav.domainId, panels: nav.panels });
      nav.clearDomain();
    }
  }, [bulkMode, bulkSnapshot, nav, setBulkSnapshot]);

  // 스택에서 제거된 패널은 수동 펼침 목록에서 정리
  useEffect(() => {
    setManualExpanded((prev) => {
      const next = new Set([...prev].filter((id) => nav.panels.some((p) => p.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [nav.panels, setManualExpanded]);

  // 패널 4개 이상일 때만 왼쪽 패널 자동 접기 (수동으로 펼친 패널은 유지)
  useEffect(() => {
    if (nav.panels.length <= 3) {
      setCollapsedPanels((prev) => {
        const next = { ...prev };
        for (const p of nav.panels) {
          next[p.id] = false;
        }
        return next;
      });
      return;
    }

    const activeKeys = new Set(nav.panels.slice(-2).map((p) => p.id));
    const leftKeys = nav.panels.slice(0, -2).map((p) => p.id);
    const pinned = manualExpandedRef.current;

    setCollapsedPanels((prev) => {
      const next = { ...prev };
      for (const key of leftKeys) {
        if (!pinned.has(key)) {
          next[key] = true;
        }
      }
      for (const key of activeKeys) {
        next[key] = false;
      }
      return next;
    });
  }, [nav.panels, setCollapsedPanels]);

  useEffect(() => {
    if (!domain || nav.panels.length < 4) {
      setDomainListOverlayOpen(false);
      setDomainListPinnedOpen(false);
    }
  }, [domain, nav.panels.length, setDomainListOverlayOpen, setDomainListPinnedOpen]);

  // 도메인 진입 시 단축키 팁 팝업 노출 (전환 직후 렌더를 막지 않도록 지연)
  useEffect(() => {
    const id = nav.domainId;
    if (id != null && id !== prevDomainIdRef.current) {
      const timer = window.setTimeout(() => triggerShortcutTip(), 0);
      prevDomainIdRef.current = id;
      return () => clearTimeout(timer);
    }
    prevDomainIdRef.current = id;
  }, [nav.domainId, triggerShortcutTip]);

  useEffect(() => {
    if (panelOverlayOpen && !nav.panels.some((p) => p.id === panelOverlayOpen)) {
      setPanelOverlayOpen(null);
    }
  }, [nav.panels, panelOverlayOpen, setPanelOverlayOpen]);

  useEffect(() => {
    if (!loading && nav.domainId != null && !domains.some((d) => d.id === nav.domainId)) {
      nav.clearDomain();
    }
  }, [loading, nav.domainId, domains, nav.clearDomain, nav]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }

    let targetScrollLeft = el.scrollLeft;
    let animationFrameId: number | null = null;

    let targetScrollTop = 0;
    let currentScrollable: HTMLElement | null = null;
    let animFrameYId: number | null = null;

    const smoothScroll = () => {
      const diff = targetScrollLeft - el.scrollLeft;
      if (Math.abs(diff) > 0.5) {
        el.scrollLeft += diff * 0.12;
        animationFrameId = requestAnimationFrame(smoothScroll);
      } else {
        el.scrollLeft = targetScrollLeft;
        animationFrameId = null;
      }
    };

    const smoothScrollY = () => {
      if (!currentScrollable) {
        return;
      }
      const diff = targetScrollTop - currentScrollable.scrollTop;
      if (Math.abs(diff) > 0.5) {
        currentScrollable.scrollTop += diff * 0.12;
        animFrameYId = requestAnimationFrame(smoothScrollY);
      } else {
        currentScrollable.scrollTop = targetScrollTop;
        animFrameYId = null;
        currentScrollable = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0 && e.deltaX === 0) {
        let target = e.target as HTMLElement | null;
        let isInsideVerticalScrollable = false;

        while (target && target !== el) {
          const style = window.getComputedStyle(target);
          const overflowY = style.overflowY;
          const isScrollable =
            (overflowY === "auto" || overflowY === "scroll") && target.scrollHeight > target.clientHeight;
          if (isScrollable) {
            isInsideVerticalScrollable = true;
            break;
          }
          target = target.parentElement;
        }

        if (!isInsideVerticalScrollable) {
          e.preventDefault();
          triggerShortcutTip();

          targetScrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, targetScrollLeft + e.deltaY * 1.0));

          if (animationFrameId === null) {
            animationFrameId = requestAnimationFrame(smoothScroll);
          }
        }
      }
    };

    const handlePanelKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        triggerShortcutTip();
        const scrollAmount = e.key === "ArrowLeft" ? -350 : 350;
        targetScrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, targetScrollLeft + scrollAmount));
        if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(smoothScroll);
        }
      }

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        triggerShortcutTip();
        const lastPanel = el.lastElementChild as HTMLElement | null;
        if (lastPanel) {
          const scrollable = lastPanel.querySelector(".overflow-y-auto, [class*='overflow-y-']") as HTMLElement | null;
          if (scrollable) {
            if (currentScrollable !== scrollable) {
              if (animFrameYId !== null) {
                cancelAnimationFrame(animFrameYId);
              }
              currentScrollable = scrollable;
              targetScrollTop = scrollable.scrollTop;
            }

            const scrollAmount = e.key === "ArrowUp" ? -250 : 250;
            targetScrollTop = Math.max(
              0,
              Math.min(scrollable.scrollHeight - scrollable.clientHeight, targetScrollTop + scrollAmount),
            );

            if (animFrameYId === null) {
              animFrameYId = requestAnimationFrame(smoothScrollY);
            }
          }
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handlePanelKeyDown);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handlePanelKeyDown);
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (animFrameYId !== null) {
        cancelAnimationFrame(animFrameYId);
      }
    };
  }, [triggerShortcutTip]);

  useEffect(() => {
    const isEditableTarget = () => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      return activeTag === "input" || activeTag === "textarea" || activeTag === "select";
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (isEditableTarget()) {
          return;
        }

        if (overlayStateRef.current.bulk) {
          const selectedIds = store.get(domainListBulkSelectedIdsAtom);
          if (selectedIds.size > 0) {
            e.preventDefault();
            const idToUrl = new Map(domainsRef.current.map((d) => [d.id, d.url]));
            const text = formatSelectedDomainUrls(store.get(domainListFilteredIdsAtom), selectedIds, idToUrl);
            if (!text) {
              return;
            }
            void copyTextToClipboard(text)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(console.error);
          }
        }
        return;
      }

      if (e.key !== "Escape" || isEditableTarget()) {
        return;
      }

      if (overlayStateRef.current.bulk) {
        e.preventDefault();
        exitBulkModeRef.current();
        return;
      }

      if (overlayStateRef.current.global) {
        e.preventDefault();
        if (isDetachedSurface) {
          void getCurrentWindow().close();
          return;
        }
        navRef.current.closeGlobalSurface();
        return;
      }
      if (overlayStateRef.current.domain) {
        e.preventDefault();
        setDomainListOverlayOpen(false);
        return;
      }
      if (overlayStateRef.current.panel) {
        e.preventDefault();
        setPanelOverlayOpen(null);
        return;
      }

      if (navRef.current.panels.length > 1) {
        e.preventDefault();
        triggerShortcutTip();
        navRef.current.closePanel(navRef.current.panels.length - 1);
      } else if (navRef.current.domainId) {
        e.preventDefault();
        triggerShortcutTip();
        navRef.current.clearDomain();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (tipTimerRef.current) {
        clearTimeout(tipTimerRef.current);
      }
    };
  }, [triggerShortcutTip, setDomainListOverlayOpen, setPanelOverlayOpen, store, isDetachedSurface]);

  const showDomainPanels = domain && !bulkMode;
  const showEmptyState = !domain && !bulkMode && !nav.globalSurface;

  if (isDetachedSurface) {
    return (
      <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
        {nav.globalSurface ? (
          <HubSurfaceOverlay surfaceId={nav.globalSurface} onClose={() => void getCurrentWindow().close()} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
      <TopBar
        onOpenProfile={() => openSurface("chrome/profile")}
        onOpenSettings={() => openSurface("chrome/settings")}
        onOpenTeam={openTeamWorkspace}
        onOpenGlobalTool={openSurface}
      />

      {domain && !bulkMode && (
        <PanelBreadcrumb
          domainLabel={getDomainLabel(domain)}
          panels={nav.panels}
          lang={lang}
          onNavigate={(id, index) => nav.navigateToPanel(id, index)}
          onClose={() => (nav.panels.length > 1 ? nav.resetPanels() : nav.clearDomain())}
          onGoHome={nav.clearDomain}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden bg-base-200 relative">
        <div ref={hubOverlayRef} className="absolute inset-0 z-[35] pointer-events-none" />
        <HubOverlayProvider containerRef={hubOverlayRef}>
          <DomainListPanel
            selectedDomainId={nav.domainId}
            onSelectDomain={nav.selectDomain}
            onClearDomain={nav.clearDomain}
            onAddDomain={() => openSurface("chrome/add-domain")}
            onManageGroups={() => openSurface("chrome/groups")}
            onEnterBulkMode={enterBulkMode}
            onExitBulkMode={exitBulkMode}
            activePanelsCount={domain ? nav.panels.length : 0}
          />

          <div className="relative flex flex-1 min-w-0 overflow-hidden border-l border-base-300">
            {bulkMode ? (
              <div className="flex flex-1 min-w-0 overflow-hidden">
                <DomainBulkManagePanel onClose={exitBulkMode} />
              </div>
            ) : showDomainPanels ? (
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <HubContextBar domain={domain} />
                <div ref={scrollContainerRef} className="flex flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
                  {nav.panels.map((panel, i) => (
                    <HubPanelWrapper
                      key={`${panel.id}-${i}`}
                      panel={panel}
                      domain={domain}
                      features={domainFeatures}
                      panelIndex={i}
                      panels={nav.panels}
                      nav={nav}
                      hostFilter={getDomainHost(domain)}
                    />
                  ))}
                </div>
              </div>
            ) : showEmptyState ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-base-100">
                <div className="w-16 h-16 rounded-2xl bg-base-200 flex items-center justify-center mb-4">
                  <Globe className="w-8 h-8 text-base-content/20" />
                </div>
                <p className="text-sm font-bold text-base-content/50">
                  {lang === "ko" ? "도메인을 선택하세요" : "Select a domain to get started"}
                </p>
              </div>
            ) : (
              <div className="flex-1 bg-base-100" />
            )}

            {nav.globalSurface && !bulkMode && (
              <HubSurfaceOverlay surfaceId={nav.globalSurface} onClose={() => nav.closeGlobalSurface()} />
            )}
          </div>

          <AnimatePresence>
            {showShortcutTip && (
              <motion.div
                initial={{ opacity: 0, y: 20, x: "-50%" }}
                animate={{ opacity: 1, y: 0, x: "-50%" }}
                exit={{ opacity: 0, y: 10, x: "-50%" }}
                transition={{ duration: 0.3 }}
                className="absolute bottom-6 left-1/2 z-50 flex items-center gap-2 bg-base-100/90 border border-base-300 px-4 py-2 rounded-full shadow-2xl text-[10px] font-bold text-base-content/85 select-none pointer-events-none backdrop-blur-md"
              >
                <Keyboard className="w-3.5 h-3.5 text-primary animate-pulse" />
                {bulkMode && (
                  <>
                    <span className={clsx(copied && "text-success transition-colors duration-200")}>
                      {copied
                        ? lang === "ko"
                          ? "복사 완료!"
                          : "Copied!"
                        : lang === "ko"
                          ? "Ctrl + C : 도메인 복사"
                          : "Ctrl + C : Copy Domains"}
                    </span>
                    <span className="text-base-content/30">|</span>
                  </>
                )}
                <span>
                  {bulkMode
                    ? lang === "ko"
                      ? "Shift: 범위 · Ctrl: 토글 · Ctrl+C: 복사"
                      : "Shift: range · Ctrl: toggle · Ctrl+C: copy"
                    : lang === "ko"
                      ? "Shift+클릭: 일괄 선택"
                      : "Shift+click: bulk select"}
                </span>
                <span className="text-base-content/30">|</span>
                <span>Alt + ← / → : {lang === "ko" ? "가로 스크롤" : "Horizontal Scroll"}</span>
                <span className="text-base-content/30">|</span>
                <span>Alt + ↑ / ↓ : {lang === "ko" ? "본문 스크롤" : "Vertical Scroll"}</span>
                <span className="text-base-content/30">|</span>
                <span>ESC : {lang === "ko" ? "닫기" : "Close"}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </HubOverlayProvider>
      </div>
    </div>
  );
}
