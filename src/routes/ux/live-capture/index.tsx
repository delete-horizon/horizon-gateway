import { createFileRoute, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Camera,
  Database,
  Edit3,
  FileText,
  Globe,
  MousePointer2,
  Play,
  RotateCw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeCustomThemeAtom, languageAtom, proxyRunningAtom } from "@/entities/app";
import type { Annotation, CapturedElement } from "@/entities/inspector";
import { hubLiveCaptureUrlAtom } from "@/features/panel-stack";
import type { ApiLogEntry, MockRule } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { annotationMatchesPage } from "@/shared/lib/guideMatch";
import { useIsHubSurfaceEmbed } from "@/shared/lib/hub/HubSurfaceEmbedContext";
import { listen } from "@/shared/lib/tauri/client";
import { useIsEmbeddedPage } from "@/shared/lib/tauri/useEmbedMode";
import { createMockModalAtom } from "@/shared/store/modals";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { toastSuccess } from "@/shared/ui/toast";
import { H1, P } from "@/shared/ui/typography/typography";

export const Route = createFileRoute("/ux/live-capture/")({
  validateSearch: (search: Record<string, unknown>) => ({
    url: (search.url as string) || undefined,
  }),
  component: LiveCaptureRoutePage,
});

type WorkspaceTab = "policy" | "traffic" | "scenario";

function LiveCaptureRoutePage() {
  const { url } = Route.useSearch();
  return <LiveCaptureWorkspace urlFromRoute={url} />;
}

export function LiveCaptureWorkspace({ urlFromRoute }: { urlFromRoute?: string } = {}) {
  const lang = useAtomValue(languageAtom);
  const seedUrl = useAtomValue(hubLiveCaptureUrlAtom);
  const routeSearch = useSearch({ strict: false }) as { url?: string };
  const isProxyRunning = useAtomValue(proxyRunningAtom);
  const [hasEnabledMockRule, setHasEnabledMockRule] = useState(false);
  const isHubEmbed = useIsHubSurfaceEmbed();
  const isPageEmbed = useIsEmbeddedPage();
  const isEmbedded = isHubEmbed || isPageEmbed;

  const initialUrl = seedUrl || urlFromRoute || routeSearch.url || "https://www.google.com";
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("policy");
  const [isSelecting, setIsSelecting] = useState(false);

  // States for Policy
  const [captured, setCaptured] = useState<CapturedElement | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // States for Traffic
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<ApiLogEntry | null>(null);
  const [trafficFilter, setTrafficFilter] = useState("");
  const [registeredDomains, setRegisteredDomains] = useState<string[]>([]);

  // States for Mocking Integration
  const [, setCreateMockModal] = useAtom(createMockModalAtom);
  const [isEditMockModalOpen, setIsEditMockModalOpen] = useState(false);
  const [editingMockRule, setEditingMockRule] = useState<MockRule | null>(null);
  const [editMockBody, setEditMockBody] = useState("");

  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void commands
      .getMockRules()
      .then(unwrap)
      .then((res) => {
        setHasEnabledMockRule(Boolean(res.success && res.data?.some((rule) => rule.enabled)));
      })
      .catch(() => setHasEnabledMockRule(false));
  }, []);

  const activeCustomTheme = useAtomValue(activeCustomThemeAtom);

  const syncStateToIframe = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "WT_SET_THEME",
          payload: activeCustomTheme,
        },
        "*",
      );
      iframeRef.current.contentWindow.postMessage(
        {
          type: "WT_UPDATE_STATUS",
          payload: {
            proxy: isProxyRunning,
            mocking: hasEnabledMockRule,
            logging: true,
          },
        },
        "*",
      );
    }
  }, [activeCustomTheme, isProxyRunning, hasEnabledMockRule]);

  // Sync Status and Theme to Iframe on changes
  useEffect(() => {
    syncStateToIframe();
  }, [syncStateToIframe]);

  const t = {
    ko: {
      title: "라이브 워크스페이스",
      subtitle: "웹 탐색, 정책 수립, 트래픽 분석을 한 곳에서 진행하세요.",
      tabPolicy: "UX 정책",
      tabTraffic: "실시간 트래픽",
      tabScenario: "모킹",
      noCaptured: "웹 화면에서 요소를 클릭하여 정책 작성을 시작하세요.",
      noLogs: "트래픽이 아직 발생하지 않았습니다.",
      saveBtn: "정책 저장",
      successMsg: "새로운 정책이 저장되었습니다.",
      selectBtn: "UI 요소 선택",
      selecting: "선택 중...",
      relatedTitle: "현재 도메인 관련 정책",
    },
    en: {
      title: "Live Workspace",
      subtitle: "Browse, document, and analyze traffic all in one place.",
      tabPolicy: "UX Policy",
      tabTraffic: "Live Traffic",
      tabScenario: "Mocking",
      noCaptured: "Click an element on the web screen to start documenting.",
      noLogs: "No traffic captured yet.",
      saveBtn: "Save Policy",
      successMsg: "New policy has been saved.",
      selectBtn: "Select UI Element",
      selecting: "Selecting...",
      relatedTitle: "Related Policies for Domain",
    },
  }[lang] || {
    title: "Live Workspace",
    subtitle: "Browse, document, and analyze traffic all in one place.",
    tabPolicy: "UX Policy",
    tabTraffic: "Live Traffic",
    tabScenario: "Mocking",
    noCaptured: "Click an element on the web screen to start documenting.",
    noLogs: "No traffic captured yet.",
    saveBtn: "Save Policy",
    successMsg: "New policy has been saved.",
    selectBtn: "Select UI Element",
    selecting: "Selecting...",
    relatedTitle: "Related Policies for Domain",
  };

  useEffect(() => {
    // 0. Load Initial Data
    commands
      .getAnnotations()
      .then(unwrap)
      .then((res) => {
        if (res.success && res.data) {
          setAnnotations(res.data);
        }
      });
    commands
      .getDomains()
      .then(unwrap)
      .then((res) => {
        if (res.success && res.data) {
          const urls = res.data.map((d) => {
            try {
              return new URL(d.url).host;
            } catch {
              return d.url;
            }
          });
          setRegisteredDomains(Array.from(new Set(urls)));
        }
      });

    // 1. Listen for UI Element Capture
    const unlistenCapture = listen<CapturedElement>("annotation-dialog-requested", (event) => {
      setCaptured(event.payload);
      setActiveTab("policy");
      setIsSelecting(false);
      setRole("");
      setDescription("");
    });

    // 2. Listen for Real-time API Logs
    const unlistenTraffic = listen<ApiLogEntry>("api-log-captured", (event) => {
      setLogs((prev) => [event.payload, ...prev].slice(0, 1000));
    });

    // 3. Listen for Messages from iframe
    const handleMessage = (event: MessageEvent) => {
      // Debug log
      console.log("Horizon Gateway App received message:", event.data.type, event.data);

      if (event.data.type === "WT_GET_THEME" || event.data.type === "WT_READY") {
        syncStateToIframe();
      }
      if (event.data.type === "WT_INSPECT_MODE_CHANGED") {
        setIsSelecting(event.data.enabled);
      }
      if (event.data.type === "WT_POLICY_SAVED") {
        console.log("Policy saved in browser, refreshing...");
        setCaptured(null); // Clear form
        commands
          .getAnnotations()
          .then(unwrap)
          .then((res) => {
            if (res.success && res.data) {
              setAnnotations(res.data);
            }
          });
      }
      if (event.data.type === "WT_ELEMENT_CAPTURED") {
        console.log("Captured element full payload:", event.data.payload);
        const capturedData = {
          ...event.data.payload,
          url: currentUrl,
          // thumbnail 데이터가 payload에 들어있으므로 자동 매핑됨
        };
        setCaptured(capturedData);
        setActiveTab("policy");
        setIsSelecting(false);
        setRole("");
        setDescription("");
      }
    };
    window.addEventListener("message", handleMessage);

    return () => {
      unlistenCapture.then((fn) => fn());
      unlistenTraffic.then((fn) => fn());
      window.removeEventListener("message", handleMessage);
    };
  }, [currentUrl, syncStateToIframe]);

  const relatedAnnotations = useMemo(() => {
    if (!currentUrl || annotations.length === 0) {
      return [];
    }
    try {
      const urlObj = new URL(currentUrl);
      return annotations.filter((ann) => annotationMatchesPage(ann, urlObj.host, urlObj.pathname));
    } catch (_e) {
      return [];
    }
  }, [annotations, currentUrl]);

  const filteredLogs = useMemo(() => {
    if (!trafficFilter.trim()) {
      return logs;
    }
    const filter = trafficFilter.toLowerCase();
    return logs.filter((log) => log.host.toLowerCase().includes(filter) || log.path.toLowerCase().includes(filter));
  }, [logs, trafficFilter]);

  const toggleSelectionMode = () => {
    const newState = !isSelecting;
    setIsSelecting(newState);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "WT_SET_INSPECT_MODE", enabled: newState }, "*");
    }
  };

  const handleGo = (e?: React.FormEvent) => {
    e?.preventDefault();
    let target = urlInput.trim();
    if (!target.includes("://")) {
      target = `https://${target}`;
    }
    setCurrentUrl(target);
    setUrlInput(target);
    setLogs([]);
  };

  const saveAnnotation = async () => {
    if (!captured) {
      return;
    }
    setIsSaving(true);
    const newAnnotation: Annotation = {
      ...captured,
      id: Math.random().toString(36).substring(2, 9),
      role,
      description,
      timestamp: Date.now(),
      hostPattern: null,
      pathPattern: null,
      locators: [],
    };
    try {
      const res = unwrap(await commands.addAnnotation(newAnnotation));
      if (res.success && res.data) {
        setAnnotations(res.data);
        setCaptured(null);
        toastSuccess(t.successMsg);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Mocking Integration Logic ──────────────────────────────────────────

  const handleSaveToScenario = () => {
    if (!selectedLog) {
      return;
    }
    setCreateMockModal({
      isOpen: true,
      logData: selectedLog,
      onSuccess: () => {
        if (isEditMockModalOpen) {
          checkAndOpenEditor(selectedLog);
        }
      },
    });
  };

  const checkAndOpenEditor = async (log: ApiLogEntry) => {
    const res = unwrap(await commands.getMockRules());
    if (res.success && res.data && Array.isArray(res.data)) {
      const existing = res.data.find((r) => r.url_pattern === log.url && r.method === log.method);
      if (existing) {
        setEditingMockRule(existing);
        setEditMockBody(existing.response_body || "");
        setIsEditMockModalOpen(true);
      } else {
        setIsEditMockModalOpen(true);
        handleSaveToScenario();
      }
    }
  };

  const handleUpdateMock = async () => {
    if (!editingMockRule) {
      return;
    }
    try {
      const res = unwrap(
        await commands.updateMockRule({
          id: editingMockRule.id,
          name: editingMockRule.name,
          host: editingMockRule.host,
          method: editingMockRule.method,
          urlPattern: editingMockRule.url_pattern,
          responseStatus: editingMockRule.response_status,
          responseHeaders: editingMockRule.response_headers,
          responseBody: editMockBody,
          enabled: editingMockRule.enabled,
        }),
      );
      if (res.success) {
        toastSuccess("실시간 응답값이 수정되었습니다. 웹 화면을 새로고침하여 확인하세요.");
        setIsEditMockModalOpen(false);
        setEditingMockRule(null);
      }
    } catch (err) {
      console.error("Update mock failed:", err);
    }
  };

  return (
    <div className={`flex flex-col gap-4 overflow-hidden ${isEmbedded ? "h-full min-h-0" : "h-[calc(100vh-100px)]"}`}>
      <header className="flex flex-col gap-2 shrink-0">
        {!isEmbedded && (
          <div className="flex items-center gap-3 px-1">
            <div className="p-2 bg-primary/20 rounded-xl text-primary">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <H1 className="text-2xl font-black">{t.title}</H1>
              <P className="text-xs text-base-content/50">{t.subtitle}</P>
            </div>
          </div>
        )}

        <form
          onSubmit={handleGo}
          className="flex items-center gap-2 bg-base-100 p-2 rounded-2xl shadow-sm border border-base-300"
        >
          <div className="flex items-center gap-1 px-2 border-r border-base-200">
            <button type="button" className="p-1.5 hover:bg-base-200 rounded-lg text-base-content/40 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button type="button" className="p-1.5 hover:bg-base-200 rounded-lg text-base-content/40 transition-colors">
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => iframeRef.current?.contentWindow?.location.reload()}
              className="p-1.5 hover:bg-base-200 rounded-lg text-base-content/40 transition-colors"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
          <Globe className="w-4 h-4 text-primary ml-2" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter website URL..."
            className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-base-content/80"
          />
          <div className="flex items-center gap-2 pr-1">
            <Button
              onClick={toggleSelectionMode}
              variant={isSelecting ? "primary" : "ghost"}
              size="sm"
              className={clsx(
                "gap-2 rounded-xl h-9 px-4 font-bold border border-base-300 transition-all",
                isSelecting && "ring-4 ring-primary/20",
              )}
            >
              <MousePointer2 className={clsx("w-4 h-4", isSelecting && "animate-bounce")} />
              {isSelecting ? t.selecting : t.selectBtn}
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              className="rounded-xl h-9 px-6 font-black uppercase tracking-tighter shadow-md"
            >
              Enter
            </Button>
          </div>
        </form>
      </header>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <div className="flex-1 relative bg-white rounded-3xl overflow-hidden border-4 border-base-300 shadow-2xl group">
          <iframe
            ref={iframeRef}
            src={currentUrl}
            onLoad={syncStateToIframe}
            className="w-full h-full border-none bg-white"
            title="Live Capture Browser"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
          <div className="absolute top-4 left-4 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-white font-bold flex items-center gap-2 border border-white/10 opacity-0 group-hover:opacity-100 transition-all">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              LIVE INTERCEPTING
            </div>
          </div>
        </div>

        <aside className="w-[450px] flex flex-col bg-base-100 rounded-3xl border border-base-300 shadow-xl overflow-hidden">
          <div className="flex p-2 bg-base-200/50 gap-1 border-b border-base-200">
            <TabButton
              active={activeTab === "policy"}
              onClick={() => setActiveTab("policy")}
              icon={<FileText className="w-4 h-4" />}
              label={t.tabPolicy}
            />
            <TabButton
              active={activeTab === "traffic"}
              onClick={() => setActiveTab("traffic")}
              icon={<Activity className="w-4 h-4" />}
              label={t.tabTraffic}
              badge={filteredLogs.length > 0 ? filteredLogs.length : undefined}
            />
            <TabButton
              active={activeTab === "scenario"}
              onClick={() => setActiveTab("scenario")}
              icon={<Database className="w-4 h-4" />}
              label={t.tabScenario}
            />
          </div>

          <div className="flex-1 overflow-y-auto relative p-4">
            {activeTab === "policy" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col gap-8">
                {!captured ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-10 opacity-30 select-none">
                    <div className="w-20 h-20 bg-base-300 rounded-full flex items-center justify-center mb-4">
                      <Camera className="w-10 h-10" />
                    </div>
                    <P className="text-sm font-bold leading-relaxed">{t.noCaptured}</P>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    <div className="bg-base-200 rounded-2xl overflow-hidden border border-base-300 aspect-video flex items-center justify-center p-4 shadow-inner relative">
                      <img
                        src={captured.thumbnail}
                        alt="Captured"
                        className="max-w-full max-h-full drop-shadow-xl rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setCaptured(null)}
                        className="absolute top-3 right-3 p-1.5 bg-black/50 text-white rounded-full hover:bg-black transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="policy-role"
                          className="text-[10px] font-black uppercase text-base-content/40 tracking-widest px-1"
                        >
                          Policy Title
                        </label>
                        <Input
                          id="policy-role"
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          placeholder="e.g. Main Navigation Interaction"
                          className="font-bold border-base-300"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="policy-desc"
                          className="text-[10px] font-black uppercase text-base-content/40 tracking-widest px-1"
                        >
                          Requirements
                        </label>
                        <textarea
                          id="policy-desc"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="textarea textarea-bordered w-full h-48 bg-base-200/20 focus:outline-primary rounded-2xl border-base-300 text-sm leading-relaxed"
                          placeholder="Document rules, expected behavior, or UI guidelines..."
                        />
                      </div>
                      <Button
                        variant="primary"
                        className="w-full h-12 gap-2 text-lg font-black"
                        onClick={saveAnnotation}
                        disabled={!role || isSaving}
                      >
                        <Save className="w-5 h-5" />
                        {t.saveBtn}
                      </Button>
                    </div>
                  </div>
                )}
                {relatedAnnotations.length > 0 && (
                  <div className="mt-4 flex flex-col gap-4 border-t border-base-200 pt-8 pb-10">
                    <div className="flex items-center gap-2 px-1">
                      <Database className="w-4 h-4 text-primary/50" />
                      <h3 className="text-[10px] font-black uppercase text-base-content/40 tracking-widest">
                        {t.relatedTitle} ({relatedAnnotations.length})
                      </h3>
                    </div>
                    <div className="flex flex-col gap-3">
                      {relatedAnnotations.map((ann) => (
                        <Card
                          key={ann.id}
                          className="p-3 bg-base-200/30 border-base-300/50 flex gap-3 hover:border-primary/30 transition-all group/item shadow-sm"
                        >
                          <div className="w-16 h-16 bg-base-200 rounded-lg overflow-hidden shrink-0 border border-base-300/50 flex items-center justify-center p-1">
                            <button
                              type="button"
                              className="w-full h-full p-0 border-none bg-transparent cursor-zoom-in focus:outline-none"
                              onClick={() => setZoomImage(ann.thumbnail)}
                              aria-label="Zoom thumbnail"
                            >
                              <img src={ann.thumbnail} alt="" className="max-w-full max-h-full object-contain" />
                            </button>
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <h4 className="font-bold text-xs text-primary truncate leading-tight">{ann.role}</h4>
                            <P className="text-[10px] text-base-content/60 line-clamp-2 leading-tight mt-1">
                              {ann.description}
                            </P>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "traffic" && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col gap-4">
                <div className="relative group/filter shrink-0">
                  <div className="flex items-center gap-2 bg-base-200/50 p-2 rounded-2xl border border-base-300 focus-within:border-primary/50 transition-all shadow-sm">
                    <Database className="w-4 h-4 text-primary/40 ml-2" />
                    <input
                      type="text"
                      list="registered-domains"
                      value={trafficFilter}
                      onChange={(e) => setTrafficFilter(e.target.value)}
                      placeholder="Filter by domain or path..."
                      className="flex-1 bg-transparent border-none outline-none text-xs font-bold text-base-content/70"
                    />
                    {trafficFilter && (
                      <button
                        type="button"
                        onClick={() => setTrafficFilter("")}
                        className="p-1 hover:bg-base-300 rounded-full text-base-content/40"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <datalist id="registered-domains">
                    {registeredDomains.map((domain) => (
                      <option key={domain} value={domain} />
                    ))}
                  </datalist>
                </div>
                {filteredLogs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-10 opacity-30 select-none h-full mt-10">
                    <Activity className="w-12 h-12 mb-4" />
                    <P className="text-sm font-bold">{t.noLogs}</P>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                    {filteredLogs.map((log, i) => (
                      <button
                        type="button"
                        key={log.id || i}
                        onClick={() => setSelectedLog(log)}
                        className={clsx(
                          "w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 group/log",
                          selectedLog?.id === log.id
                            ? "bg-primary/10 border-primary shadow-sm"
                            : "bg-base-200/50 border-base-300 hover:bg-base-200",
                        )}
                      >
                        <div
                          className={clsx(
                            "px-2 py-0.5 rounded text-[9px] font-black w-14 text-center shrink-0",
                            log.method === "GET" ? "bg-success/20 text-success" : "bg-info/20 text-info",
                          )}
                        >
                          {log.method}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[11px] font-bold truncate text-base-content/80">{log.path}</span>
                            {log.response_headers &&
                              Object.keys(log.response_headers).some(
                                (k) => k.toLowerCase() === "x-mocked-by" || k.toLowerCase() === "x-mock-rule-id",
                              ) && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">
                                  MOCK
                                </span>
                              )}
                          </div>
                          <div className="text-[9px] text-base-content/40 font-mono mt-0.5">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                        <div
                          className={clsx(
                            "text-[10px] font-bold shrink-0",
                            (log.status_code || 0) < 400 ? "text-success" : "text-error",
                          )}
                        >
                          {log.status_code || "---"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {selectedLog && (
        <div
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-10 animate-in zoom-in-95 duration-200"
          onClick={() => setSelectedLog(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSelectedLog(null);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="presentation" className="w-full max-w-2xl">
            <Card className="max-h-[80vh] bg-base-100 flex flex-col overflow-hidden shadow-2xl border-none ring-1 ring-white/10">
              <div className="p-6 border-b border-base-200 flex justify-between items-center bg-base-200/30">
                <div className="flex items-center gap-3">
                  <span className="badge badge-primary font-black uppercase text-[10px] py-3">
                    {selectedLog.method}
                  </span>
                  <h3 className="font-bold text-sm truncate max-w-sm">{selectedLog.path}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="p-2 hover:bg-base-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <section>
                  <h4 className="text-[10px] font-black uppercase text-base-content/40 tracking-widest mb-3 flex items-center gap-2">
                    <Play className="w-3 h-3" /> Response Body
                  </h4>
                  <div className="bg-base-200 p-4 rounded-2xl font-mono text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-96 border border-base-300/50">
                    {selectedLog.response_body || "// No response body"}
                  </div>
                </section>
                <div className="grid grid-cols-2 gap-4">
                  <Button variant="secondary" className="gap-2 text-xs font-bold" onClick={handleSaveToScenario}>
                    <Database className="w-4 h-4" /> Save as Snapshot
                  </Button>
                  <Button
                    variant="primary"
                    className="gap-2 text-xs font-bold"
                    onClick={() => checkAndOpenEditor(selectedLog)}
                  >
                    <Edit3 className="w-4 h-4" /> Live Edit Mock
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {isEditMockModalOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-10 animate-in fade-in zoom-in-95 duration-200"
          onClick={() => setIsEditMockModalOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsEditMockModalOpen(false);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div onClick={(e) => e.stopPropagation()} role="presentation" className="w-full max-w-3xl">
            <Card className="bg-base-100 flex flex-col shadow-2xl overflow-hidden border-none ring-1 ring-primary/20">
              <div className="p-6 border-b border-base-200 flex justify-between items-center bg-primary/5">
                <div className="flex items-center gap-3">
                  <Edit3 className="w-5 h-5 text-primary" />
                  <h3 className="font-bold">Live API Response Editor</h3>
                </div>
                <button type="button" onClick={() => setIsEditMockModalOpen(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 p-6 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-xs bg-base-200 p-3 rounded-xl border border-base-300">
                  <span className="badge badge-sm badge-primary font-black uppercase">{editingMockRule?.method}</span>
                  <code className="truncate flex-1 font-mono text-base-content/60">{editingMockRule?.url_pattern}</code>
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <label
                    htmlFor="mock-body-editor"
                    className="text-[10px] font-black uppercase text-base-content/40 tracking-widest px-1"
                  >
                    Response Body (JSON/Text)
                  </label>
                  <textarea
                    id="mock-body-editor"
                    value={editMockBody}
                    onChange={(e) => setEditMockBody(e.target.value)}
                    className="flex-1 textarea textarea-bordered font-mono text-xs p-4 bg-slate-900 text-green-400 rounded-2xl min-h-[350px] border-none focus:outline-primary shadow-inner"
                  />
                </div>
              </div>
              <div className="p-6 bg-base-200/30 border-t border-base-200 flex gap-3">
                <Button variant="ghost" onClick={() => setIsEditMockModalOpen(false)} className="flex-1">
                  취소
                </Button>
                <Button variant="primary" onClick={handleUpdateMock} className="flex-[2] gap-2 font-black">
                  <Save className="w-5 h-5" /> 실시간 반영하기
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {zoomImage && (
        <div
          className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-md flex items-center justify-center p-10 animate-in fade-in duration-300"
          onClick={() => setZoomImage(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setZoomImage(null);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <button
            type="button"
            className="absolute top-10 right-10 text-white/50 hover:text-white"
            onClick={() => setZoomImage(null)}
          >
            <X className="w-10 h-10" />
          </button>
          <img
            src={zoomImage}
            alt="Zoomed"
            className="max-w-full max-h-full shadow-2xl rounded-2xl animate-in zoom-in-95 duration-300"
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all font-black text-[11px] uppercase tracking-tighter",
        active
          ? "bg-primary text-primary-content shadow-lg shadow-primary/20 scale-[1.02]"
          : "text-base-content/40 hover:bg-base-200 hover:text-base-content",
      )}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span
          className={clsx(
            "ml-1 px-1.5 py-0.5 rounded-full text-[9px]",
            active ? "bg-white/20" : "bg-primary/10 text-primary",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
