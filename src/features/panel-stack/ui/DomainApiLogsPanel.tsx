import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import { Clock, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { languageAtom, usePromiseModal } from "@/entities/app";
import { fetchApiLogDetail } from "@/entities/domain-api-logging";
import {
  ApiLogsBulkExportBar,
  apiLogEntryToCopyInput,
  downloadApiExchangesHtml,
  revealDownloadedApiExchangesHtml,
} from "@/entities/sandbox";
import type { ApiLogEntry, Domain } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { listen } from "@/shared/lib/tauri/client";
import { offerRevealSavedDownload } from "@/shared/lib/tauri/offerRevealSavedDownload";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import { LoadingScreen } from "@/shared/ui/loader/LoadingScreen";
import { useDomainFeatureToggles } from "../hooks/useDomainFeatureToggles";
import { useDomainHubData } from "../hooks/useDomainHubData";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import { domainApiLogsMethodAtom, domainApiLogsSearchAtom } from "../store";
import { Panel } from "./Panel";

interface DomainApiLogsPanelProps {
  domain: Domain;
  onClose: () => void;
  onSelectLog: (logId: string) => void;
  selectedLogId?: string;
}

const METHODS = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export function DomainApiLogsPanel({ domain, onClose, onSelectLog, selectedLogId }: DomainApiLogsPanelProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const { show: showModal, alert: showAlert } = usePromiseModal();
  const {
    getDomainHost,
    getFeatureState,
    fetchAll: fetchHubData,
    hubProxySettings,
    setHubProxySettings,
  } = useDomainHubData();
  const host = getDomainHost(domain);
  const featureState = getFeatureState(domain.id);
  const toggles = useDomainFeatureToggles({
    domainId: domain.id,
    domainUrl: domain.url,
    state: featureState,
    onRefresh: fetchHubData,
  });
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useAtom(domainApiLogsSearchAtom);
  const [methodFilter, setMethodFilter] = useAtom(domainApiLogsMethodAtom);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(() => new Set());
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const retentionDays = hubProxySettings?.log_retention_days ?? 14;

  const handleRetentionChange = async (days: number) => {
    if (days === retentionDays) {
      return;
    }
    const isForever = days === 0;
    const confirmed = await showModal({
      title: lang === "ko" ? "API 로그 보관 주기 변경" : "Change API Log Retention Policy",
      message:
        lang === "ko"
          ? `API 로그 보관 주기는 모든 도메인에 공통으로 적용되는 전역(Global) 설정입니다.\n\n${
              isForever
                ? "로그 자동 삭제를 끄고 영구 보관하시겠습니까?"
                : `현재 시점 기준 ${days}일이 지난 모든 도메인의 과거 로그(본문 및 검색 인덱스)는 디스크에서 즉시 정리됩니다.\n\n보관 주기를 ${days}일로 변경하시겠습니까?`
            }`
          : `Log retention is a global setting applied across all domains.\n\n${
              isForever
                ? "Do you want to disable auto-cleanup and keep logs forever?"
                : `Logs older than ${days} days across all domains will be permanently purged from disk.\n\nDo you want to change retention to ${days} days?`
            }`,
      confirmText: lang === "ko" ? "변경 적용" : "Apply",
      cancelText: lang === "ko" ? "취소" : "Cancel",
      type: "warning",
    });

    if (!confirmed) {
      return;
    }

    setRetentionSaving(true);
    try {
      const res = await commands.updateProxySettings({ logRetentionDays: days }).then(unwrap);
      if (res.success && res.data) {
        setHubProxySettings(res.data);
      }
      await showAlert(
        lang === "ko" ? "보관 주기 변경 완료" : "Retention Updated",
        lang === "ko"
          ? `API 로그 보관 주기가 ${isForever ? "무제한 (영구 보관)" : `${days}일`}로 설정되었습니다.`
          : `API log retention updated to ${isForever ? "Forever" : `${days} days`}.`,
        "success",
      );
      void fetchLogs();
    } catch (e) {
      console.error("updateProxySettings retention:", e);
      await showAlert(lang === "ko" ? "설정 변경 실패" : "Update Failed", String(e), "danger");
    } finally {
      setRetentionSaving(false);
    }
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await commands
        .getApiLogs({ date: today, domainFilter: host, methodFilter: null, hostFilter: null, exactMatch: null })
        .then(unwrap);
      if (res.success && res.data) {
        setLogs(res.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const unlisten = listen<ApiLogEntry>("api-log-captured", (event) => {
      const entry = event.payload;
      if (!entry.host.includes(host) && entry.host !== host) {
        return;
      }
      setLogs((prev) => {
        if (prev.some((l) => l.id === entry.id)) {
          return prev;
        }
        const stub: ApiLogEntry = {
          ...entry,
          request_headers: null,
          request_body: null,
          response_headers: null,
          response_body: null,
          is_mocked: entry.is_mocked,
          has_bodies: Boolean(
            entry.has_bodies ||
              entry.request_body ||
              entry.response_body ||
              entry.request_headers ||
              entry.response_headers,
          ),
        };
        return [stub, ...prev];
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [host]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (methodFilter !== "ALL" && entry.method.toUpperCase() !== methodFilter) {
        return false;
      }
      if (q && !entry.path.toLowerCase().includes(q) && !entry.url.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [logs, search, methodFilter]);

  const hasFilters = search.trim().length > 0 || methodFilter !== "ALL";

  const copyFieldLabels = useMemo(
    () => ({
      requestHeaders: t.apiLogRequestHeaders,
      requestBody: t.apiLogRequestBody,
      responseHeaders: t.apiLogResponseHeaders,
      responseBody: t.apiLogResponseBody,
    }),
    [t],
  );

  const handleToggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedLogIds(new Set(filteredLogs.map((log) => log.id)));
  }, [filteredLogs]);

  const handleClearSelection = useCallback(() => {
    setSelectedLogIds(new Set());
  }, []);

  const handleOpenSavedFolder = useCallback(async () => {
    if (!lastSavedPath) {
      return;
    }
    try {
      await revealDownloadedApiExchangesHtml(lastSavedPath);
    } catch (e) {
      console.error("revealDownloadedApiExchangesHtml:", e);
    }
  }, [lastSavedPath]);

  const handleDownloadSelectedHtml = useCallback(async () => {
    const selectedIds = filteredLogs.filter((log) => selectedLogIds.has(log.id)).map((l) => l.id);
    if (selectedIds.length === 0) {
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const details = (await Promise.all(selectedIds.map((id) => fetchApiLogDetail(id, today)))).filter(
      (l): l is ApiLogEntry => l != null,
    );
    const inputs = details.map((log) => apiLogEntryToCopyInput(log, copyFieldLabels));
    try {
      const result = await downloadApiExchangesHtml(
        inputs,
        {
          ...copyFieldLabels,
          documentTitle: t.apiLogsExportDocumentTitle,
          exportedAt: t.apiLogsExportExportedAt,
          entryCount: t.apiLogsExportEntryCount,
          tableOfContents: t.apiLogsExportTableOfContents,
          copyResponse: t.apiLogsExportCopyResponse,
          copyRequest: t.apiLogsExportCopyRequest,
          copyExchange: t.apiLogsExportCopyExchange,
          copyAllResponses: t.apiLogsExportCopyAllResponses,
          copied: t.apiLogCopied,
          generatedBy: t.apiLogsExportGeneratedBy,
          jumpToEntry: t.apiLogsExportJumpToEntry,
        },
        `horizon-gateway-api-logs-${host}-${today}-${details.length}.html`,
      );
      if (result.status !== "saved") {
        return;
      }
      setLastSavedPath(result.path);
      await offerRevealSavedDownload({
        path: result.path,
        title: t.apiLogsDownloadComplete,
        message: t.apiLogsDownloadCompleteMessage(result.path),
        openFolderText: t.apiLogsOpenFolder,
        closeText: lang === "ko" ? "닫기" : "Close",
        show: showModal,
      });
    } catch (e) {
      console.error("downloadApiExchangesHtml:", e);
    }
  }, [copyFieldLabels, filteredLogs, host, lang, selectedLogIds, showModal, t]);

  const allFilteredSelected = filteredLogs.length > 0 && filteredLogs.every((log) => selectedLogIds.has(log.id));
  const someFilteredSelected = filteredLogs.some((log) => selectedLogIds.has(log.id));

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <Panel id="api/logs" title={t.apiLogs} subtitle={host} onClose={onClose} width="lg">
      <div className="flex flex-col gap-2 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.apiLogsSearchPlaceholder}
              className="pl-8 h-8 text-xs rounded-lg"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => void fetchLogs()}
            disabled={loading}
            title={t.apiLogsRefresh}
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
          {toggles.api.checked && (
            <label className="flex items-center gap-1.5 px-2.5 h-8 bg-base-200/50 hover:bg-base-200 rounded-lg text-xs font-bold text-base-content/70 cursor-pointer shrink-0 select-none transition-colors border border-base-300/40">
              <span className="whitespace-nowrap">{t.apiBodyLogging}</span>
              {toggles.api.bodyLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
              ) : (
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-xs shrink-0"
                  checked={toggles.api.bodyChecked ?? false}
                  onChange={(e) => toggles.api.toggleBody(e.target.checked)}
                />
              )}
            </label>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          <div className="flex gap-1 shrink-0">
            {METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setMethodFilter(method)}
                className={clsx(
                  "px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors whitespace-nowrap shrink-0",
                  methodFilter === method
                    ? "bg-primary/20 text-primary"
                    : "bg-base-200 text-base-content/50 hover:bg-base-300",
                )}
              >
                {method}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-1 px-1.5 py-0.5 bg-base-200/60 rounded-md text-[10px] font-bold text-base-content/60 shrink-0 border border-base-300/40 ml-auto"
            title={
              lang === "ko"
                ? "API 로그 전역 보관 주기 (모든 도메인 공통)"
                : "Global API log retention period (all domains)"
            }
          >
            <Clock className="w-3 h-3 text-base-content/40 shrink-0" />
            <select
              value={retentionDays}
              disabled={retentionSaving}
              onChange={(e) => void handleRetentionChange(Number(e.target.value))}
              className="bg-transparent border-none outline-none text-[10px] font-bold text-base-content cursor-pointer"
            >
              <option value={7}>{t.apiLogsRetention7Days}</option>
              <option value={14}>{t.apiLogsRetention14Days}</option>
              <option value={30}>{t.apiLogsRetention30Days}</option>
              <option value={90}>{t.apiLogsRetention90Days}</option>
              <option value={0}>{t.apiLogsRetentionForever}</option>
            </select>
          </div>
        </div>
        {hasFilters && (
          <p className="text-[10px] text-base-content/40 px-0.5">
            {filteredLogs.length}/{logs.length}
          </p>
        )}
        <ApiLogsBulkExportBar
          selectedCount={selectedLogIds.size}
          totalCount={filteredLogs.length}
          labels={{
            selected: t.apiLogsBulkSelected,
            selectAll: t.apiLogsBulkSelectAll,
            clearSelection: t.apiLogsBulkClearSelection,
            downloadHtml: t.apiLogsBulkDownloadHtml,
            openFolder: t.apiLogsOpenFolder,
            downloadComplete: t.apiLogsDownloadComplete,
          }}
          onSelectAll={handleSelectAllFiltered}
          onClearSelection={handleClearSelection}
          onDownloadHtml={() => void handleDownloadSelectedHtml()}
          lastSavedPath={lastSavedPath}
          onOpenFolder={() => void handleOpenSavedFolder()}
        />
      </div>

      {loading && logs.length === 0 ? (
        <LoadingScreen />
      ) : logs.length === 0 ? (
        <p className="text-xs text-base-content/50">{t.apiNoLogs}</p>
      ) : filteredLogs.length === 0 ? (
        <p className="text-xs text-base-content/50">{t.apiLogsNoMatch}</p>
      ) : (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="flex items-center gap-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-base-content/35 shrink-0">
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) {
                  el.indeterminate = someFilteredSelected && !allFilteredSelected;
                }
              }}
              onChange={(e) => {
                if (e.target.checked) {
                  handleSelectAllFiltered();
                } else {
                  handleClearSelection();
                }
              }}
              aria-label={t.apiLogsBulkSelectAll}
            />
            <span>{t.apiLogsBulkSelectAll}</span>
          </div>

          <div ref={parentRef} className="overflow-y-auto min-h-0 flex-1 relative pr-1">
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const log = filteredLogs[virtualRow.index];
                if (!log) {
                  return null;
                }
                return (
                  <div
                    key={log.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-1"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectLog(log.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectLog(log.id);
                        }
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-2 py-2 rounded-lg border transition-colors cursor-pointer",
                        selectedLogId === log.id
                          ? "bg-primary/10 border-primary/30"
                          : "border-transparent hover:bg-base-200",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-primary shrink-0"
                        checked={selectedLogIds.has(log.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleToggleSelect(log.id, e.target.checked)}
                        aria-label={`Select ${log.method} ${log.path}`}
                      />
                      <span className="text-[9px] font-black bg-base-300 px-1.5 py-0.5 rounded shrink-0">
                        {log.method}
                      </span>
                      <span className="text-[10px] font-mono truncate flex-1 min-w-0">{log.path}</span>
                      {Boolean(
                        log.is_mocked ||
                          (log.response_headers &&
                            Object.keys(log.response_headers).some(
                              (k) => k.toLowerCase() === "x-mocked-by" || k.toLowerCase() === "x-mock-rule-id",
                            )),
                      ) && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">
                          MOCK
                        </span>
                      )}
                      <span
                        className={clsx(
                          "text-[9px] font-bold shrink-0",
                          (log.status_code ?? 0) >= 400 ? "text-error" : "text-success",
                        )}
                      >
                        {log.status_code ?? "-"}
                      </span>
                      <span className="text-[9px] text-base-content/30 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
