import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue, useStore } from "jotai";
import { ExternalLink, X } from "lucide-react";
import { Suspense } from "react";
import { languageAtom, WindowControls } from "@/entities/app";
import { HubSurfaceEmbedProvider } from "@/shared/lib/hub/HubSurfaceEmbedContext";
import { notifyHubHandoff } from "@/shared/lib/tauri/hubEvents";
import { openDetachedHubSurface } from "@/shared/lib/tauri/openHubSurface";
import { useIsDetachedWindow } from "@/shared/lib/tauri/useEmbedMode";
import { Button } from "@/shared/ui/button/Button";
import { LoadingScreen } from "@/shared/ui/loader/LoadingScreen";
import { useHubHandoffValue } from "../hooks/useHubHandoff";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import { ActiveSurfaceProvider } from "../lib/ActiveSurfaceContext";
import { getSurfaceEntry } from "../lib/surfaceRegistry";
import { hubLiveCaptureUrlAtom, hubMonitorLogsHostAtom } from "../store";
import type { HubSurfaceId } from "../types";

interface HubSurfaceOverlayProps {
  surfaceId: HubSurfaceId;
  onClose: () => void;
  onDetach?: () => void;
}

function resolveTitle(titleKey: string, t: typeof ko): string {
  const map: Record<string, string> = {
    infrastructure: t.infrastructure,
    settings: t.settings,
    addDomain: t.addDomain,
    manageGroups: t.manageGroups,
    profile: t.profile,
    team: t.team,
    toolsPipeline: t.toolsPipeline,
    toolsCrypto: t.toolsCrypto,
    toolsPreview: t.toolsPreview,
    toolsApiClient: t.toolsApiClient,
    toolsApiMocking: t.toolsApiMocking,
    toolsJsonSchema: t.toolsJsonSchema,
    toolsServerLogs: t.toolsServerLogs,
    apiLogs: t.apiLogs,
    apiMocking: t.apiMocking,
    apiSchema: t.apiSchema,
    toolsProxyGraph: t.toolsProxyGraph,
    toolsMonitor: t.toolsMonitor,
    toolsPolicies: t.toolsPolicies,
    toolsLiveCapture: t.toolsLiveCapture,
    toolsMonitorLogs: t.toolsMonitorLogs,
  };
  return map[titleKey] ?? titleKey;
}

export function HubSurfaceOverlay({ surfaceId, onClose, onDetach }: HubSurfaceOverlayProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const entry = getSurfaceEntry(surfaceId);
  const title = resolveTitle(entry.titleKey, t);
  const SurfaceComponent = entry.Component;
  const activeHandoff = useHubHandoffValue();
  const isDetached = useIsDetachedWindow();
  const store = useStore();

  const handleDetach = () => {
    if (onDetach) {
      onDetach();
      return;
    }
    const extra: Record<string, string> = {};
    if (surfaceId === "global/monitor-logs") {
      const host = store.get(hubMonitorLogsHostAtom);
      if (host) {
        extra.host = host;
      }
    }
    if (surfaceId === "global/live-capture") {
      const url = store.get(hubLiveCaptureUrlAtom);
      if (url) {
        extra.url = url;
      }
    }
    void openDetachedHubSurface(surfaceId, title, entry.detachWidth, entry.detachHeight, extra);
    if (activeHandoff) {
      void notifyHubHandoff(activeHandoff, { scope: "global", surfaceId });
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key={surfaceId}
        initial={isDetached ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={isDetached ? undefined : { opacity: 0, x: 12 }}
        transition={{ duration: 0.2 }}
        className={
          isDetached
            ? "flex flex-col h-full min-h-0 bg-base-100"
            : "absolute inset-0 z-40 flex flex-col bg-base-100 border-l-2 border-primary/20 shadow-[-4px_0_24px_rgba(0,0,0,0.08)]"
        }
      >
        <div
          data-tauri-drag-region={isDetached || undefined}
          onDoubleClick={isDetached ? () => void getCurrentWindow().toggleMaximize() : undefined}
          className="flex items-center gap-2 h-10 px-3 border-b border-base-300 bg-base-200/80 shrink-0"
        >
          <div className="flex-1 min-w-0 pointer-events-none flex flex-col justify-center">
            <p className="text-xs font-black text-base-content truncate">{title}</p>
            {entry.kind !== "chrome" && (
              <p className="text-[10px] text-base-content/45 font-medium">{lang === "ko" ? "전체 보기" : "Global"}</p>
            )}
          </div>
          {!isDetached && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[10px] font-bold"
              onClick={handleDetach}
              title={t.surfaceDetach}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.surfaceDetach}</span>
            </Button>
          )}
          {isDetached ? (
            <WindowControls scope="window" />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onClose}
              title={t.surfaceClose}
              aria-label={t.surfaceClose}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <HubSurfaceEmbedProvider onDismiss={onClose}>
            <ActiveSurfaceProvider surfaceId={surfaceId}>
              <Suspense fallback={<LoadingScreen />}>
                <SurfaceComponent />
              </Suspense>
            </ActiveSurfaceProvider>
          </HubSurfaceEmbedProvider>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
