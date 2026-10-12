import { createFileRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import { useAtom, useAtomValue } from "jotai";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FlaskConical,
  GlobeIcon,
  History,
  Search,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiLoggingCountAtom, domainCountAtom, languageAtom, proxyRunningAtom, usePromiseModal } from "@/entities/app";
import { fetchApiLogDetail } from "@/entities/domain-api-logging";
import { hubProxySettingsAtom } from "@/entities/domain-hub";
import { ProxyServerWarning } from "@/entities/proxy";
import {
  ApiLogExchangeDetail,
  ApiLogsBulkExportBar,
  apiLogEntryToCopyInput,
  downloadApiExchangesHtml,
  revealDownloadedApiExchangesHtml,
  savedJsonSchemasAtom,
  validateJsonSchema,
} from "@/entities/sandbox";
import { hubApiLogsHostSeedAtom } from "@/features/panel-stack";
import type { ApiLogEntry } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { listen } from "@/shared/lib/tauri/client";
import { offerRevealSavedDownload } from "@/shared/lib/tauri/offerRevealSavedDownload";
import { createMockModalAtom } from "@/shared/store/modals";
import { Badge } from "@/shared/ui/badge/badge";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { EmptyState } from "@/shared/ui/empty-state/EmptyState";
import { LoadingScreen } from "@/shared/ui/loader/LoadingScreen";
import { Modal } from "@/shared/ui/modal/Modal";
import { en } from "./en";
import { ko } from "./ko";
import { apiLogsDateAtom, apiLogsHostFilterAtom, apiLogsMethodFilterAtom, apiLogsSearchAtom } from "./store";

export const Route = createFileRoute("/apis/logs/")({
  component: ApiLogs,
});

// ─── LogRow: memoized row to avoid full-list re-renders on updates ────────────
interface LogRowProps {
  entry: ApiLogEntry;
  formattedTime: string;
  selected: boolean;
  onClick: (entry: ApiLogEntry) => void;
  onToggleSelect: (id: string, checked: boolean) => void;
}

const LogRow = React.memo(function LogRowItem({
  entry,
  formattedTime,
  selected,
  onClick,
  onToggleSelect,
}: LogRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(entry);
        }
      }}
      className="w-full grid grid-cols-[32px_60px_50px_1fr] tablet:grid-cols-[32px_80px_60px_1fr_120px] gap-2 tablet:gap-4 items-center px-4 tablet:px-6 py-2 hover:bg-base-200/50 transition-all group border-l-4 border-l-transparent hover:border-l-primary border-b border-base-300/50 cursor-pointer"
    >
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          className="checkbox checkbox-xs checkbox-primary"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleSelect(entry.id, e.target.checked)}
          aria-label={`Select ${entry.method} ${entry.path}`}
        />
      </div>
      <div className="flex shrink-0">
        <Badge
          variant={{
            color:
              (entry.status_code ?? 0) >= 500
                ? "red"
                : (entry.status_code ?? 0) >= 400
                  ? "amber"
                  : (entry.status_code ?? 0) >= 300
                    ? "blue"
                    : "green",
            size: "sm",
          }}
          className="font-black w-[40px] tablet:w-[50px] text-[10px] tablet:text-xs justify-center tracking-tighter"
        >
          {entry.status_code ?? "-"}
        </Badge>
      </div>
      <span
        className={`font-black text-[9px] tablet:text-[10px] uppercase tracking-tighter shrink-0 ${
          entry.method === "GET"
            ? "text-success"
            : entry.method === "POST"
              ? "text-info"
              : entry.method === "PUT"
                ? "text-warning"
                : entry.method === "DELETE"
                  ? "text-error"
                  : "text-base-content/60"
        }`}
      >
        {entry.method}
      </span>

      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-xs tablet:text-sm font-bold text-base-content/80 truncate font-mono tracking-tight"
            title={entry.url}
          >
            {entry.path}
          </span>
          {entry.response_headers &&
            Object.keys(entry.response_headers).some(
              (k) => k.toLowerCase() === "x-mocked-by" || k.toLowerCase() === "x-mock-rule-id",
            ) && (
              <span className="px-1.5 py-0.2 rounded text-[8px] tablet:text-[9px] font-black bg-purple-500/20 text-purple-400 border border-purple-500/30 shrink-0">
                MOCK
              </span>
            )}
        </div>
        <span className="text-[9px] tablet:text-[10px] text-base-content/40 font-bold uppercase truncate tracking-wider">
          {entry.host}
        </span>
      </div>

      <span className="hidden tablet:block text-xs text-base-content/40 font-mono text-right tabular-nums group-hover:text-base-content/80 transition-colors shrink-0">
        {formattedTime}
      </span>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────
function ApiLogs() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const { show: showModal, alert: showAlert } = usePromiseModal();
  const [date, setDate] = useAtom(apiLogsDateAtom);
  const [, setAvailableDates] = useState<string[]>([]);
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [hasPendingUpdates, setHasPendingUpdates] = useState(false);
  const [search, setSearch] = useAtom(apiLogsSearchAtom);
  const [localSearch, setLocalSearch] = useState(search);
  const [hostFilter, setHostFilter] = useAtom(apiLogsHostFilterAtom);
  const [localHostFilter, setLocalHostFilter] = useState(hostFilter);
  const [apiLogsHostSeed, setApiLogsHostSeed] = useAtom(hubApiLogsHostSeedAtom);
  const [methodFilter, setMethodFilter] = useAtom(apiLogsMethodFilterAtom);
  const [selectedLog, setSelectedLog] = useState<ApiLogEntry | null>(null);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(() => new Set());
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [bodySearch, setBodySearch] = useState("");
  const [bodySearchBusy, setBodySearchBusy] = useState(false);
  const [bodySearchActive, setBodySearchActive] = useState(false);
  const [hubProxySettings, setHubProxySettings] = useAtom(hubProxySettingsAtom);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [, setCreateMockModal] = useAtom(createMockModalAtom);
  const savedJsonSchemas = useAtomValue(savedJsonSchemasAtom);
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
      void fetchDates();
      void fetchLogs(date, "refresh");
    } catch (e) {
      console.error("updateProxySettings retention:", e);
      await showAlert(lang === "ko" ? "설정 변경 실패" : "Update Failed", String(e), "danger");
    } finally {
      setRetentionSaving(false);
    }
  };

  useEffect(() => {
    if (!apiLogsHostSeed) {
      return;
    }
    setHostFilter(apiLogsHostSeed);
    setLocalHostFilter(apiLogsHostSeed);
    setApiLogsHostSeed(null);
  }, [apiLogsHostSeed, setApiLogsHostSeed, setHostFilter]);

  // Schema validation state for log detail modal
  const [logSchemaEnabled, setLogSchemaEnabled] = useState(false);
  const [logSchemaText, setLogSchemaText] = useState("");
  const [logSchemaResult, setLogSchemaResult] = useState<{ valid: boolean; errors: string | null } | null>(null);

  // Run schema validation when enabled/response/schema changes in modal
  // Guards: payload size limit (500 KB) + debounce 600ms to prevent hammering
  // the Rust backend on every keystroke or large log body.
  useEffect(() => {
    if (!logSchemaEnabled || !selectedLog?.response_body) {
      setLogSchemaResult(null);
      return;
    }
    const body = selectedLog.response_body ?? "";
    if (body.length > 500_000) {
      setLogSchemaResult({
        valid: false,
        errors: `Payload too large for validation (${(body.length / 1024).toFixed(0)} KB). Limit: 500 KB.`,
      });
      return;
    }
    if (!logSchemaText.trim()) {
      setLogSchemaResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await validateJsonSchema(body, logSchemaText);
        setLogSchemaResult(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Validation failed";
        setLogSchemaResult({ valid: false, errors: message });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [logSchemaEnabled, selectedLog, logSchemaText]);

  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(localSearch), 600);
    return () => clearTimeout(timer);
  }, [localSearch, setSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setHostFilter(localHostFilter), 600);
    return () => clearTimeout(timer);
  }, [localHostFilter, setHostFilter]);

  const domainCount = useAtomValue(domainCountAtom);
  const apiLoggingCount = useAtomValue(apiLoggingCountAtom);
  const isProxyRunning = useAtomValue(proxyRunningAtom);

  // ── Filter refs: always up-to-date inside the polling interval without ──────
  // ── recreating fetchLogs (and therefore the interval) on every change. ──────
  const searchRef = useRef(search);
  const methodFilterRef = useRef(methodFilter);
  const hostFilterRef = useRef(hostFilter);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  useEffect(() => {
    methodFilterRef.current = methodFilter;
  }, [methodFilter]);
  useEffect(() => {
    hostFilterRef.current = hostFilter;
  }, [hostFilter]);

  // 날짜 목록 조회
  const fetchDates = useCallback(async () => {
    try {
      const res = await commands.listApiLogDates().then(unwrap);
      if (res.success && res.data) {
        setAvailableDates(res.data);
      }
    } catch (e) {
      console.error("list_api_log_dates:", e);
    }
  }, []);

  // Abort ref: cancels stale in-flight data writes — does NOT gate loading state
  const fetchAbortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  const logMatchesCurrentFilters = useCallback((entry: ApiLogEntry) => {
    const domainFilter = searchRef.current.trim();
    const method = methodFilterRef.current;
    const host = hostFilterRef.current.trim();
    if (method && entry.method !== method) {
      return false;
    }
    if (host && !entry.host.includes(host)) {
      return false;
    }
    if (domainFilter && !entry.url.includes(domainFilter)) {
      return false;
    }
    return true;
  }, []);

  // 로그 목록 조회 — stable function reference; reads filters from refs
  type FetchMode = "initial" | "silent" | "refresh";

  const fetchLogs = useCallback(async (targetDate: string, mode: FetchMode = "silent") => {
    const requestId = ++activeRequestRef.current;

    // Abort the previous request so its result doesn't overwrite ours
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    if (mode === "initial") {
      setInitialLoading(true);
    }
    if (mode === "refresh") {
      setRefreshing(true);
    }
    if (mode === "silent") {
      setIsFetching(true);
    }

    try {
      const res = await commands
        .getApiLogs({
          date: targetDate,
          domainFilter: null,
          methodFilter: null,
          hostFilter: null,
          exactMatch: null,
        })
        .then(unwrap);

      // Don't update state with a stale response
      if (controller.signal.aborted || requestId !== activeRequestRef.current) {
        return;
      }

      if (res.success && res.data) {
        setLogs(res.data);
      } else {
        setLogs([]);
      }
    } catch (e: unknown) {
      if (controller.signal.aborted || requestId !== activeRequestRef.current) {
        return;
      }
      console.error("get_api_logs:", e);
      setLogs([]);
    } finally {
      if (requestId === activeRequestRef.current) {
        if (mode === "initial") {
          setInitialLoading(false);
        }
        if (mode === "refresh") {
          setRefreshing(false);
        }
        if (mode === "silent") {
          setIsFetching(false);
        }
      }
    }
  }, []);

  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  useEffect(() => {
    setHasPendingUpdates(false);
    if (hasLoadedOnceRef.current) {
      setLogs([]);
    }
    const mode: FetchMode = hasLoadedOnceRef.current ? "silent" : "initial";
    void fetchLogs(date, mode).finally(() => {
      hasLoadedOnceRef.current = true;
    });
  }, [date, fetchLogs]);

  // Proxy captures a log → notify when it matches the selected date + filters
  useEffect(() => {
    const unlisten = listen<ApiLogEntry>("api-log-captured", (event) => {
      const entry = event.payload;
      const logDate = entry.timestamp.length >= 10 ? entry.timestamp.slice(0, 10) : "";
      if (logDate !== dateRef.current) {
        return;
      }
      if (!logMatchesCurrentFilters(entry)) {
        return;
      }
      setHasPendingUpdates(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [logMatchesCurrentFilters]);

  const handleRefresh = useCallback(() => {
    setHasPendingUpdates(false);
    setBodySearchActive(false);
    void fetchLogs(date, "refresh");
  }, [date, fetchLogs]);

  const handleBodySearch = useCallback(async () => {
    const raw = bodySearch.trim();
    if (!raw) {
      setBodySearchActive(false);
      void fetchLogs(date, "refresh");
      return;
    }
    setBodySearchBusy(true);
    setBodySearchActive(true);
    try {
      const paramMatch = raw.match(/^([A-Za-z_][\w.]*)\s*=\s*(.*)$/);
      const res = await commands
        .searchApiLogs({
          date,
          query: paramMatch ? null : raw,
          hostFilter: hostFilter.trim() || null,
          methodFilter: methodFilter || null,
          statusFilter: null,
          paramKey: paramMatch ? paramMatch[1] : null,
          paramValue: paramMatch ? paramMatch[2] : null,
          limit: 100,
        })
        .then(unwrap);
      if (res.success && res.data) {
        setLogs(
          res.data.map((hit) => ({
            id: hit.summary.id,
            timestamp: hit.summary.timestamp,
            method: hit.summary.method,
            url: hit.summary.url || `https://${hit.summary.host}${hit.summary.path}`,
            host: hit.summary.host,
            path: hit.summary.path,
            status_code: hit.summary.status_code,
            request_headers: null,
            request_body: null,
            response_headers: null,
            response_body: null,
            has_bodies: hit.summary.has_bodies,
          })),
        );
      } else {
        setLogs([]);
      }
    } catch (e) {
      console.error("search_api_logs:", e);
      setLogs([]);
    } finally {
      setBodySearchBusy(false);
    }
  }, [bodySearch, date, fetchLogs, hostFilter, methodFilter]);

  const changeDate = (days: number) => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    setDate(newDate.toISOString().split("T")[0]);
  };

  const handleClearLogs = async (clearAll: boolean) => {
    if (!confirm(clearAll ? t.clearAllConfirm : t.clearConfirm(date))) {
      return;
    }
    setClearing(true);
    try {
      await commands
        .clearApiLogs({
          date: clearAll ? null : date,
        })
        .then(unwrap);
      setLogs([]);
      await fetchDates();
    } catch (e) {
      console.error("clear_api_logs:", e);
    } finally {
      setClearing(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      // 1. Method filter
      if (methodFilter && entry.method !== methodFilter) {
        return false;
      }
      // 2. Host filter
      if (localHostFilter.trim()) {
        const filterStr = localHostFilter.trim().toLowerCase();
        if (!entry.host.toLowerCase().includes(filterStr)) {
          return false;
        }
      }
      // 3. Search / path filter
      if (localSearch.trim()) {
        const filterStr = localSearch.trim().toLowerCase();
        if (!entry.path.toLowerCase().includes(filterStr) && !entry.url.toLowerCase().includes(filterStr)) {
          return false;
        }
      }
      return true;
    });
  }, [logs, methodFilter, localHostFilter, localSearch]);

  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  // Pre-format all timestamps once when logs change — avoids calling new Date() per virtualised row render
  const formattedTimestamps = useMemo(() => {
    return filteredLogs.map((log) =>
      new Date(log.timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }, [filteredLogs]);

  // Stable row click handler — hydrate detail (bodies) on demand
  const handleRowClick = useCallback(async (log: ApiLogEntry) => {
    setSelectedLog(log);
    const detail = await fetchApiLogDetail(log.id, dateRef.current);
    if (detail) {
      setSelectedLog(detail);
    }
  }, []);

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

  const copyFieldLabels = useMemo(
    () => ({
      requestHeaders: t.requestHeaders,
      requestBody: t.requestBody,
      responseHeaders: t.responseHeaders,
      responseBody: t.responseBody,
    }),
    [t],
  );

  const handleDownloadSelectedHtml = useCallback(async () => {
    const selectedIds = filteredLogs.filter((log) => selectedLogIds.has(log.id)).map((l) => l.id);
    if (selectedIds.length === 0) {
      return;
    }
    const details = (await Promise.all(selectedIds.map((id) => fetchApiLogDetail(id, date)))).filter(
      (l): l is ApiLogEntry => l != null,
    );
    const inputs = details.map((log) => apiLogEntryToCopyInput(log, copyFieldLabels));
    try {
      const result = await downloadApiExchangesHtml(
        inputs,
        {
          ...copyFieldLabels,
          documentTitle: t.exportDocumentTitle,
          exportedAt: t.exportExportedAt,
          entryCount: t.exportEntryCount,
          tableOfContents: t.exportTableOfContents,
          copyResponse: t.exportCopyResponse,
          copyRequest: t.exportCopyRequest,
          copyExchange: t.exportCopyExchange,
          copyAllResponses: t.exportCopyAllResponses,
          copied: t.copied,
          generatedBy: t.exportGeneratedBy,
          jumpToEntry: t.exportJumpToEntry,
        },
        `horizon-gateway-api-logs-${date}-${details.length}.html`,
      );
      if (result.status !== "saved") {
        return;
      }
      setLastSavedPath(result.path);
      await offerRevealSavedDownload({
        path: result.path,
        title: t.downloadComplete,
        message: t.downloadCompleteMessage(result.path),
        openFolderText: t.openFolder,
        closeText: t.close,
        show: showModal,
      });
    } catch (e) {
      console.error("downloadApiExchangesHtml:", e);
    }
  }, [copyFieldLabels, date, filteredLogs, selectedLogIds, showModal, t]);

  const allFilteredSelected = filteredLogs.length > 0 && filteredLogs.every((log) => selectedLogIds.has(log.id));
  const someFilteredSelected = filteredLogs.some((log) => selectedLogIds.has(log.id));

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

  return (
    <div className="flex flex-col gap-6 pb-20 h-[calc(100vh-6rem)] overflow-hidden">
      <AnimatePresence>
        {initialLoading && logs.length === 0 && (
          <LoadingScreen key="logs-loader" onCancel={() => setInitialLoading(false)} />
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex flex-col tablet:flex-row justify-between items-start tablet:items-center gap-4 shrink-0 px-1">
        <div>
          <div className="flex items-center gap-3 mb-1 tablet:mb-2">
            <div className="p-1.5 tablet:p-2 bg-secondary/10 text-secondary rounded-lg">
              <History className="w-4 h-4 tablet:w-5 tablet:h-5" />
            </div>
            <h1 className="text-2xl tablet:text-3xl font-black tracking-tight text-base-content">{t.title}</h1>
          </div>
          <p className="text-base-content/60 text-xs tablet:text-sm font-medium">{t.subtitle}</p>
        </div>

        {isProxyRunning && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Retention Selector */}
            <div
              className="flex items-center gap-1.5 bg-base-100 px-2.5 rounded-xl border border-base-300 shadow-sm h-9 tablet:h-10 transition-colors"
              title={
                lang === "ko"
                  ? "API 로그 전역 보관 주기 (모든 도메인 공통)"
                  : "Global API log retention period (all domains)"
              }
            >
              <Clock className="w-3.5 h-3.5 text-base-content/40 shrink-0" />
              <span className="text-[10px] tablet:text-xs font-bold text-base-content/60 shrink-0">{t.retention}:</span>
              <select
                value={retentionDays}
                disabled={retentionSaving}
                onChange={(e) => void handleRetentionChange(Number(e.target.value))}
                className="bg-transparent border-none outline-none text-[11px] tablet:text-xs font-bold text-base-content cursor-pointer pr-1"
              >
                <option value={7}>{t.retention7Days}</option>
                <option value={14}>{t.retention14Days}</option>
                <option value={30}>{t.retention30Days}</option>
                <option value={90}>{t.retention90Days}</option>
                <option value={0}>{t.retentionForever}</option>
              </select>
            </div>

            <Button
              variant={hasPendingUpdates ? "primary" : "secondary"}
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 h-9 tablet:h-10 px-3 tablet:px-4 whitespace-nowrap shrink-0"
            >
              <History className={clsx("w-3.5 h-3.5 tablet:w-4 tablet:h-4", refreshing && "animate-spin")} />
              <span className="text-xs tablet:text-sm">{t.refresh}</span>
            </Button>

            {/* Date Navigator */}
            <div className="flex items-center gap-1 tablet:gap-2 bg-base-100 p-0.5 tablet:p-1 rounded-xl border border-base-300 shadow-sm h-9 tablet:h-10">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => changeDate(-1)}
                className="h-7 w-7 tablet:h-8 tablet:w-8"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1 tablet:gap-2 px-1 tablet:px-3">
                <Calendar className="w-3.5 h-3.5 tablet:w-4 tablet:h-4 text-base-content/40" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-[11px] tablet:text-sm font-bold text-base-content outline-none bg-transparent w-[100px] tablet:w-[110px]"
                />
              </div>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => changeDate(1)}
                disabled={date === new Date().toISOString().split("T")[0]}
                className="h-7 w-7 tablet:h-8 tablet:w-8"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </header>

      <ProxyServerWarning />

      {isProxyRunning && (
        <>
          {hasPendingUpdates && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-info/10 border border-info/30 rounded-xl shrink-0">
              <p className="text-xs tablet:text-sm font-bold text-info">{t.newLogsAvailable}</p>
              <Button variant="primary" size="sm" onClick={handleRefresh} disabled={refreshing}>
                {t.refreshNow}
              </Button>
            </div>
          )}

          {/* Filters & Actions */}
          <div className="flex flex-col tablet:flex-row gap-3 shrink-0">
            <div className="flex flex-1 gap-3">
              <Card className="p-2 bg-base-100 border-base-300 flex-1 flex items-center gap-3 px-3 tablet:px-4 shadow-sm h-10 tablet:h-auto">
                <Search className="w-3.5 h-3.5 tablet:w-4 tablet:h-4 text-base-content/40 shrink-0" />
                <input
                  type="text"
                  placeholder={t.filterPath}
                  className="bg-transparent border-none outline-none text-xs tablet:text-sm w-full font-bold min-w-0 placeholder:text-base-content/30 text-base-content"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => setLocalSearch("")}
                    className="text-base-content/40 hover:text-base-content/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </Card>

              <Card className="p-2 bg-base-100 border-base-300 flex-1 flex items-center gap-3 px-3 tablet:px-4 shadow-sm h-10 tablet:h-auto">
                <GlobeIcon className="w-3.5 h-3.5 tablet:w-4 tablet:h-4 text-base-content/40 shrink-0" />
                <input
                  type="text"
                  placeholder={t.filterHost}
                  className="bg-transparent border-none outline-none text-xs tablet:text-sm w-full font-bold min-w-0 placeholder:text-base-content/30 text-base-content"
                  value={localHostFilter}
                  onChange={(e) => setLocalHostFilter(e.target.value)}
                />
                {localHostFilter && (
                  <button
                    type="button"
                    onClick={() => setLocalHostFilter("")}
                    className="text-base-content/40 hover:text-base-content/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </Card>
            </div>

            <div className="flex flex-1 gap-2 items-center">
              <Card className="p-2 bg-base-100 border-base-300 flex-1 flex items-center gap-3 px-3 tablet:px-4 shadow-sm h-10 tablet:h-auto">
                <FileText className="w-3.5 h-3.5 tablet:w-4 tablet:h-4 text-base-content/40 shrink-0" />
                <input
                  type="text"
                  placeholder={lang === "ko" ? "본문 검색 (텍스트 또는 key=value)" : "Body search (text or key=value)"}
                  className="bg-transparent border-none outline-none text-xs tablet:text-sm w-full font-bold min-w-0 placeholder:text-base-content/30 text-base-content"
                  value={bodySearch}
                  onChange={(e) => setBodySearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleBodySearch();
                    }
                  }}
                />
                {bodySearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setBodySearch("");
                      setBodySearchActive(false);
                      void fetchLogs(date, "refresh");
                    }}
                    className="text-base-content/40 hover:text-base-content/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </Card>
              <Button
                variant={bodySearchActive ? "primary" : "secondary"}
                size="sm"
                disabled={bodySearchBusy}
                onClick={() => void handleBodySearch()}
                className="shrink-0 h-10"
              >
                {bodySearchBusy ? "…" : lang === "ko" ? "본문 검색" : "Search body"}
              </Button>
            </div>

            <div className="flex items-center gap-1 tablet:gap-2 bg-base-100 rounded-xl border border-base-300 p-0.5 tablet:p-1 shadow-sm overflow-x-auto [scrollbar-width:none]">
              <Button
                variant={methodFilter === "" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setMethodFilter("")}
                className="font-black text-[9px] tablet:text-[10px] uppercase tracking-tighter h-8 px-2 tablet:px-3"
              >
                {t.allMethods}
              </Button>
              <div className="w-px h-4 bg-base-300 mx-0.5 tablet:mx-1 shrink-0" />
              {METHODS.map((m) => (
                <Button
                  key={m}
                  variant={methodFilter === m ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setMethodFilter(methodFilter === m ? "" : m)}
                  className="font-black text-[9px] tablet:text-[10px] h-8 px-2 tablet:px-3 uppercase tracking-tighter shrink-0"
                >
                  {m}
                </Button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex items-center gap-2 h-9 tablet:h-auto whitespace-nowrap shrink-0 flex-1 tablet:flex-initial"
                onClick={() => handleClearLogs(false)}
                disabled={clearing || logs.length === 0}
              >
                <Trash2 className="w-3.5 h-3.5 tablet:w-4 tablet:h-4" />
                <span className="text-xs tablet:text-sm">{t.clearDate(date)}</span>
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="flex items-center gap-1.5 tablet:gap-2 h-9 tablet:h-auto whitespace-nowrap shrink-0 flex-1 tablet:flex-initial"
                onClick={() => handleClearLogs(true)}
                disabled={clearing}
              >
                <Trash2 className="w-3.5 h-3.5 tablet:w-4 tablet:h-4" />
                <span className="text-xs tablet:text-sm">{t.clearAll}</span>
              </Button>
            </div>
          </div>

          <ApiLogsBulkExportBar
            selectedCount={selectedLogIds.size}
            totalCount={filteredLogs.length}
            labels={{
              selected: t.bulkSelected,
              selectAll: t.bulkSelectAll,
              clearSelection: t.bulkClearSelection,
              downloadHtml: t.bulkDownloadHtml,
              openFolder: t.openFolder,
              downloadComplete: t.downloadComplete,
            }}
            onSelectAll={handleSelectAllFiltered}
            onClearSelection={handleClearSelection}
            onDownloadHtml={() => void handleDownloadSelectedHtml()}
            lastSavedPath={lastSavedPath}
            onOpenFolder={() => void handleOpenSavedFolder()}
          />

          {/* Log List */}
          <div className="bg-base-100 rounded-2xl border border-base-300 shadow-xl overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="grid grid-cols-[32px_60px_50px_1fr] tablet:grid-cols-[32px_80px_60px_1fr_120px] gap-2 tablet:gap-4 px-4 tablet:px-6 py-3 bg-base-200/50 border-b border-base-300 text-[9px] tablet:text-[10px] font-black text-base-content/40 uppercase tracking-widest shrink-0 items-center">
              <div className="flex justify-center">
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
                  aria-label={t.bulkSelectAll}
                />
              </div>
              <div>{t.status}</div>
              <div>{t.method}</div>
              <div>{t.urlPath}</div>
              <div className="hidden tablet:block text-right">{t.time}</div>
            </div>

            <div ref={parentRef} className="overflow-y-auto flex-1 p-0 relative">
              {domainCount === 0 ? (
                <div className="p-4">
                  <EmptyState tier={1} lang={lang} />
                </div>
              ) : apiLoggingCount === 0 ? (
                <div className="p-4">
                  <EmptyState
                    tier={2}
                    icon={History}
                    title={t.noApiLoggingTitle}
                    description={t.noApiLoggingDesc}
                    actionLabel={t.noApiLoggingAction}
                    actionHref="/apis/settings"
                  />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-30 grayscale">
                  <FileText className="w-12 h-12 text-base-content" />
                  <p className="text-sm font-black uppercase tracking-widest text-base-content">
                    {initialLoading || refreshing || isFetching ? t.loadingLogs : t.noLogsFound}
                  </p>
                </div>
              ) : (
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
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <LogRow
                          entry={log}
                          formattedTime={formattedTimestamps[virtualRow.index] ?? ""}
                          selected={selectedLogIds.has(log.id)}
                          onClick={handleRowClick}
                          onToggleSelect={handleToggleSelect}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Log Detail Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => {
          setSelectedLog(null);
          setLogSchemaEnabled(false);
          setLogSchemaResult(null);
        }}
        size="4xl"
      >
        <Modal.Header title={t.logDetails} description={selectedLog?.id} />
        <Modal.Body className="flex flex-col gap-6 py-4 max-h-[70vh] overflow-y-auto px-6">
          {selectedLog && (
            <ApiLogExchangeDetail
              log={selectedLog}
              labels={{
                request: t.request,
                requestBody: t.requestBody,
                requestHeaders: t.requestHeaders,
                responseBody: t.responseBody,
                responseHeaders: t.responseHeaders,
                status: t.status,
                time: t.time,
                empty: t.empty,
                btnCopy: t.btnCopy,
                copied: t.copied,
                copyHtml: t.copyHtml,
                copyMarkdown: t.copyMarkdown,
              }}
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex items-center gap-1.5 h-8 font-bold"
                  onClick={() => {
                    setCreateMockModal({
                      isOpen: true,
                      logData: selectedLog,
                    });
                  }}
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Save as Mock</span>
                </Button>
              }
              responseViewerProps={{
                t,
                showSchemaTab: true,
                enableSchemaValidation: logSchemaEnabled,
                onToggleSchemaValidation: setLogSchemaEnabled,
                schemaText: logSchemaText,
                onChangeSchemaText: setLogSchemaText,
                schemaValidationResult: logSchemaResult,
                savedJsonSchemas,
                heightClass: "",
                bodyPanelHeightClass: "min-h-[280px] max-h-[50vh]",
                hideOnEmpty: false,
              }}
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedLog(null)} className="w-full sm:w-auto">
            {t.close}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
