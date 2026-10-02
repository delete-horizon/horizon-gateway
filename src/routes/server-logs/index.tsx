import { createFileRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { atom, useAtom, useAtomValue } from "jotai";
import { Copy, Pause, Play, SearchIcon, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { proxyRunningAtom } from "@/entities/app";
import { ProxyServerWarning } from "@/entities/proxy";
import { atomWithWindowStorage } from "@/shared/lib/jotai/window-storage";
import { useIsEmbeddedPage } from "@/shared/lib/tauri/useEmbedMode";
import { Modal } from "@/shared/ui/modal/Modal";

interface ServerLog {
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

const MAX_LOGS = 10000;
const serverLogsAtom = atom<ServerLog[]>([]);

// Isolated but persistent UI states
const logSearchAtom = atomWithWindowStorage("server-logs-search", "");
const logFilterLevelAtom = atomWithWindowStorage("server-logs-filter-level", "ALL");
const logIsPausedAtom = atomWithWindowStorage("server-logs-paused", false);

export const Route = createFileRoute("/server-logs/")({
  component: ServerLogsPage,
});

function ServerLogsPage() {
  const [logs, setLogs] = useAtom(serverLogsAtom);
  const [isPaused, setIsPaused] = useAtom(logIsPausedAtom);
  const [search, setSearch] = useAtom(logSearchAtom);
  const [filterLevel, setFilterLevel] = useAtom(logFilterLevelAtom);
  const [selectedLog, setSelectedLog] = useState<ServerLog | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const isProxyRunning = useAtomValue(proxyRunningAtom);
  const isEmbedded = useIsEmbeddedPage();

  // Keep track of pause state for listener
  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const unlisten = listen<ServerLog>("server-log", (event) => {
      if (!isPausedRef.current) {
        setLogs((prev) => {
          const newLogs = [...prev, event.payload];
          if (newLogs.length > MAX_LOGS) {
            return newLogs.slice(newLogs.length - MAX_LOGS);
          }
          return newLogs;
        });
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [setLogs]);

  const filteredLogs = useMemo(() => {
    let result = logs;

    if (filterLevel !== "ALL") {
      result = result.filter((log) => log.level === filterLevel);
    }

    if (search) {
      const lowerSearch = search.toLowerCase();
      result = result.filter(
        (log) => log.message.toLowerCase().includes(lowerSearch) || log.target.toLowerCase().includes(lowerSearch),
      );
    }

    return result;
  }, [logs, search, filterLevel]);

  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // height of line
    overscan: 20,
  });

  const clearLogs = () => setLogs([]);

  // Auto-scroll to bottom if not paused
  useEffect(() => {
    if (!isPaused && filteredLogs.length > 0) {
      virtualizer.scrollToIndex(filteredLogs.length - 1);
    }
  }, [filteredLogs.length, isPaused, virtualizer]);

  return (
    <div
      className={`flex flex-col space-y-4 overflow-hidden ${isEmbedded ? "h-full min-h-0" : "h-[calc(100vh-8rem)]"}`}
    >
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 shrink-0">
        {!isEmbedded && (
          <h1 className="text-2xl tablet:text-3xl font-black tracking-tight text-base-content font-sans">
            Server Logs
          </h1>
        )}
        {isProxyRunning && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative flex-1 tablet:flex-initial min-w-[140px]">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-base-content/40" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 bg-base-100 border border-base-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full tablet:w-48 transition-all text-base-content placeholder:text-base-content/30"
              />
            </div>
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="px-3 py-2 bg-base-100 border border-base-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all cursor-pointer text-base-content h-9"
            >
              <option value="ALL">All Levels</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
            <div className="flex gap-2 w-full tablet:w-auto">
              <button
                type="button"
                onClick={() => setIsPaused((p) => !p)}
                className="flex-1 tablet:flex-initial flex items-center justify-center px-4 py-2 bg-base-100 border border-base-200 rounded-lg hover:bg-base-200 text-sm font-bold transition-all text-base-content h-9"
              >
                {isPaused ? <Play className="w-3.5 h-3.5 mr-2" /> : <Pause className="w-3.5 h-3.5 mr-2" />}
                {isPaused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={clearLogs}
                className="tablet:flex-initial flex items-center justify-center px-4 py-2 bg-base-100 border border-error/20 rounded-lg hover:bg-error/10 text-sm font-bold text-error transition-all h-9"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <ProxyServerWarning />

      {isProxyRunning && (
        <div className="flex-1 bg-base-100 rounded-xl p-4 shadow-inner overflow-hidden flex flex-col mt-4">
          <div
            ref={parentRef}
            className="flex-1 overflow-auto rounded text-sm text-base-content/80 font-mono styling-scrollbar"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const log = filteredLogs[virtualItem.index];
                return (
                  <div
                    key={virtualItem.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    onClick={() => setSelectedLog(log)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setSelectedLog(log);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="flex items-center space-x-2 tablet:space-x-3 px-2 hover:bg-base-300/50 whitespace-nowrap overflow-hidden text-ellipsis transition-colors cursor-pointer"
                  >
                    <span className="hidden tablet:inline text-base-content/40 shrink-0 w-32 xl:w-64 text-[10px] tablet:text-xs font-semibold">
                      {log.timestamp}
                    </span>
                    <span className="tablet:hidden text-base-content/40 shrink-0 w-20 text-[10px] uppercase font-mono">
                      {log.timestamp.split(" ")[1]}
                    </span>
                    <span
                      className={clsx(
                        "shrink-0 font-bold w-12 tablet:w-16 text-[10px] tablet:text-xs",
                        log.level === "ERROR"
                          ? "text-error"
                          : log.level === "WARN"
                            ? "text-warning"
                            : log.level === "INFO"
                              ? "text-info"
                              : "text-base-content/40",
                      )}
                    >
                      {log.level.padEnd(5)}
                    </span>
                    <span className="hidden tablet:inline text-primary/80 shrink-0 min-w-24 tablet:min-w-32 truncate max-w-48 tablet:max-w-64 border-r border-base-300 pr-3 text-[10px] tablet:text-xs text-right tablet:text-left">
                      {log.target}
                    </span>
                    <span className="text-base-content leading-none truncate text-xs tablet:text-sm">
                      {log.message}
                    </span>
                  </div>
                );
              })}
              {filteredLogs.length === 0 && (
                <div className="flex items-center justify-center h-full text-base-content/40 w-full mt-12 text-sm">
                  No logs generated yet. Wait for events or check terminal.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)}>
        <Modal.Header title="Log Details" description={selectedLog?.target} />
        <Modal.Body>
          <div className="flex flex-col space-y-5">
            <div className="flex gap-6">
              <div>
                <span className="text-xs font-semibold text-base-content/40 block mb-1.5 uppercase tracking-wider">
                  Level
                </span>
                <span
                  className={clsx(
                    "px-2.5 py-1 rounded-md text-xs font-bold border",
                    selectedLog?.level === "ERROR"
                      ? "text-error bg-error/10 border-error/20"
                      : selectedLog?.level === "WARN"
                        ? "text-warning bg-warning/10 border-warning/20"
                        : selectedLog?.level === "INFO"
                          ? "text-info bg-info/10 border-info/20"
                          : "text-base-content/60 bg-base-200 border-base-300",
                  )}
                >
                  {selectedLog?.level}
                </span>
              </div>
              <div className="flex-1">
                <span className="text-xs font-semibold text-base-content/40 block mb-1.5 uppercase tracking-wider">
                  Timestamp
                </span>
                <span className="text-sm font-mono text-base-content/80 bg-base-200 px-2.5 py-1 rounded-md border border-base-300 inline-block">
                  {selectedLog?.timestamp}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-base-content/40 uppercase tracking-wider">Message</span>
                {selectedLog && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(selectedLog.message)}
                    className="text-xs text-info hover:text-info/80 font-medium flex items-center bg-info/10 px-2 py-1 rounded-md transition-colors"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </button>
                )}
              </div>
              <div className="bg-base-200 text-base-content p-4 rounded-xl shadow-inner max-h-96 overflow-y-auto scrollbar-thin">
                <LogMessageViewer message={selectedLog?.message || ""} />
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={() => setSelectedLog(null)}
            className="px-5 py-2.5 bg-base-100 border border-base-200 hover:bg-base-200 text-base-content/80 rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow"
          >
            Close
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

function LogMessageViewer({ message }: { message: string }) {
  // Check if it's a DNS dump (e.g., from hickory-resolver)
  if (message.includes("; header ") || message.match(/; query/)) {
    const lines = message.split("\n");
    return (
      <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
        {lines.map((line, i) => {
          const trimmed = line.trim();

          if (trimmed.startsWith(";") || trimmed.startsWith("response: ;")) {
            return (
              <div
                key={`${i}-${trimmed}`}
                className="text-base-content/40 mt-3 mb-1 font-semibold border-b border-base-300/50 pb-1"
              >
                {line}
              </div>
            );
          }

          const parts = trimmed.split(/\s+/);
          const inIndex = parts.indexOf("IN");

          if (inIndex >= 1 && parts.length > inIndex + 1) {
            const name = parts.slice(0, inIndex - 1).join(" ");
            const ttl = parts[inIndex - 1];
            const type = parts[inIndex + 1];
            const data = parts.slice(inIndex + 2).join(" ");

            return (
              <div
                key={`${i}-${trimmed}`}
                className="flex flex-wrap items-center gap-4 py-1 ml-2 text-base-content/80 border-l-2 border-base-300 pl-4 hover:bg-base-300/50 transition-colors rounded-r-md"
              >
                <span className="text-info break-all min-w-[280px] flex-[2]" title={name}>
                  {name}
                </span>
                <span className="text-base-content/40 text-xs w-12 text-right px-1 shrink-0" title="TTL">
                  {ttl}
                </span>
                <span className="text-secondary font-bold w-24 shrink-0 px-2 bg-secondary/10 rounded">IN {type}</span>
                <span className="text-success break-all flex-[3] min-w-[200px]">{data}</span>
              </div>
            );
          }

          if (!trimmed) {
            return null;
          }

          return (
            <div key={`${i}-${trimmed}`} className="text-base-content/80 ml-2">
              {line}
            </div>
          );
        })}
      </div>
    );
  }

  // General text highlighting for typical logs
  const highlightRegex =
    /(ERROR|WARN|INFO|DEBUG|CONNECT|GET|POST|PUT|DELETE|HTTP\/\d\.\d|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/g;
  const tokens = message.split(highlightRegex);

  return (
    <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-all text-base-content">
      {tokens.map((token, i) => {
        if (token === "ERROR") {
          return (
            <span key={`${i}-t`} className="text-error font-bold">
              {token}
            </span>
          );
        }
        if (token === "WARN") {
          return (
            <span key={`${i}-t`} className="text-warning font-bold">
              {token}
            </span>
          );
        }
        if (token === "INFO") {
          return (
            <span key={`${i}-t`} className="text-info font-bold">
              {token}
            </span>
          );
        }
        if (token === "DEBUG") {
          return (
            <span key={`${i}-t`} className="text-base-content/55 font-bold">
              {token}
            </span>
          );
        }
        if (["CONNECT", "GET", "POST", "PUT", "DELETE"].includes(token)) {
          return (
            <span key={`${i}-t`} className="text-success font-bold">
              {token}
            </span>
          );
        }
        if (token.startsWith("HTTP/")) {
          return (
            <span key={`${i}-t`} className="text-secondary font-bold">
              {token}
            </span>
          );
        }
        if (token.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
          return (
            <span key={`${i}-t`} className="text-accent font-bold">
              {token}
            </span>
          );
        }
        return <span key={`${i}-t`}>{token}</span>;
      })}
    </div>
  );
}
