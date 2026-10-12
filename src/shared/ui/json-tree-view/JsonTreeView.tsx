import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, Copy, Info } from "lucide-react";
import type React from "react";
import { createContext, memo, useContext, useMemo, useState } from "react";
import { useAppLang } from "@/shared/lib/i18n/app-lang";
import { Button } from "../button/Button";

const en = {
  hint: "Click to collapse or expand. Drag to copy part of the text.",
  copyAll: "Copy all",
  copiedAll: "Copied!",
  expand: "Expand",
  collapse: "Collapse",
  showLess: "Show less",
  showAllChars: (count: number) => `Show all +${count.toLocaleString()} characters`,
  copyNode: "Copy this node",
  showMore: (count: number, remaining: number) => `Show ${count} more ( ${remaining} left )`,
  showAllItems: (count: number) => `Show all (${count})`,
  empty: "(Empty)",
};

const ko: typeof en = {
  hint: "클릭하여 접기/펼치기 · 드래그하여 부분 복사 가능",
  copyAll: "전체 복사",
  copiedAll: "복사됨!",
  expand: "펼치기",
  collapse: "접기",
  showLess: "간략히",
  showAllChars: (count: number) => `+${count.toLocaleString()}자 전체보기`,
  copyNode: "이 노드 데이터 복사",
  showMore: (count: number, remaining: number) => `+ ${count}개 항목 더보기 (남은 ${remaining}개)`,
  showAllItems: (count: number) => `전체 표시 (${count}개)`,
  empty: "(비어 있음)",
};

const TreeCopyContext = createContext(en);

function useTreeCopy() {
  return useContext(TreeCopyContext);
}

const CHUNK_SIZE = 100;
const STRING_PREVIEW_LIMIT = 2000;

export interface JsonTreeViewProps {
  data: unknown;
  rawString?: string;
  initialFoldDepth?: number;
  showToolbar?: boolean;
  emptyLabel?: string;
  className?: string;
  hintText?: string;
  copyAllLabel?: string;
  copiedAllLabel?: string;
}

export function JsonTreeView({
  data,
  rawString,
  initialFoldDepth = 2,
  showToolbar = true,
  emptyLabel,
  className,
  hintText,
  copyAllLabel,
  copiedAllLabel,
}: JsonTreeViewProps) {
  const copy = useAppLang() === "ko" ? ko : en;
  const resolvedEmpty = emptyLabel ?? copy.empty;
  const resolvedHint = hintText ?? copy.hint;
  const resolvedCopyAll = copyAllLabel ?? copy.copyAll;
  const resolvedCopiedAll = copiedAllLabel ?? copy.copiedAll;
  const [copiedAll, setCopiedAll] = useState(false);

  const { parsedData, isError, formattedString } = useMemo(() => {
    if (data === undefined || data === null || data === "") {
      if (rawString) {
        try {
          const parsed = JSON.parse(rawString);
          return {
            parsedData: parsed,
            isError: false,
            formattedString: JSON.stringify(parsed, null, 2),
          };
        } catch {
          return { parsedData: null, isError: true, formattedString: rawString };
        }
      }
      return { parsedData: null, isError: false, formattedString: "" };
    }

    if (typeof data === "string") {
      const trimmed = data.trim();
      if (!trimmed) {
        return { parsedData: null, isError: false, formattedString: "" };
      }
      try {
        const parsed = JSON.parse(trimmed);
        return {
          parsedData: parsed,
          isError: false,
          formattedString: JSON.stringify(parsed, null, 2),
        };
      } catch {
        return { parsedData: null, isError: true, formattedString: data };
      }
    }

    try {
      return {
        parsedData: data,
        isError: false,
        formattedString: JSON.stringify(data, null, 2),
      };
    } catch {
      return {
        parsedData: null,
        isError: true,
        formattedString: String(data),
      };
    }
  }, [data, rawString]);

  const handleCopyAll = async () => {
    if (!formattedString) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formattedString);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch (e) {
      console.error("Failed to copy JSON:", e);
    }
  };

  if (!formattedString && parsedData === null) {
    return <p className="text-base-content/40 italic m-0 text-xs">{resolvedEmpty}</p>;
  }

  if (isError || parsedData === null) {
    return (
      <pre className="m-0 font-mono text-xs whitespace-pre-wrap break-all leading-relaxed text-base-content/85 select-text">
        {formattedString}
      </pre>
    );
  }

  return (
    <TreeCopyContext.Provider value={copy}>
      <div className={clsx("flex flex-col gap-2 min-h-0 flex-1", className)}>
        {showToolbar && (
          <div className="flex items-center justify-between gap-2 shrink-0 select-none px-1">
            <span className="text-[10px] text-base-content/50 font-medium flex items-center gap-1.5">
              <Info className="w-3 h-3 shrink-0 text-base-content/40" />
              {resolvedHint}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void handleCopyAll()}
              className="h-6 px-2 gap-1 text-[10px] font-semibold text-base-content/70 hover:text-base-content"
            >
              {copiedAll ? <Check className="w-3 h-3 text-success shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
              {copiedAll ? resolvedCopiedAll : resolvedCopyAll}
            </Button>
          </div>
        )}

        <div className="font-mono text-xs leading-relaxed select-text min-w-0">
          <MemoTreeNode value={parsedData} isLast={true} depth={0} initialFoldDepth={initialFoldDepth} />
        </div>
      </div>
    </TreeCopyContext.Provider>
  );
}

interface TreeNodeProps {
  keyName?: string;
  value: unknown;
  isLast?: boolean;
  depth: number;
  initialFoldDepth: number;
}

function StringValueNode({
  indentStr,
  renderGutter,
  renderKey,
  value,
  comma,
}: {
  indentStr: string;
  renderGutter: (collapsible: boolean) => React.ReactNode;
  renderKey: React.ReactNode;
  value: string;
  comma: string;
}) {
  const copy = useTreeCopy();
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > STRING_PREVIEW_LIMIT;

  const displayString = !isLong || expanded ? value : `${value.slice(0, STRING_PREVIEW_LIMIT)}...`;

  return (
    <div className="leading-relaxed whitespace-pre-wrap break-all flex items-center flex-wrap group/node">
      <span className="select-none whitespace-pre">{indentStr}</span>
      {renderGutter(false)}
      {renderKey}
      <span className="text-emerald-600 dark:text-emerald-400">"{displayString}"</span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] font-sans px-1.5 py-0.5 ml-1.5 rounded bg-base-200 text-primary hover:underline cursor-pointer"
        >
          {expanded ? copy.showLess : copy.showAllChars(value.length - STRING_PREVIEW_LIMIT)}
        </button>
      )}
      <span className="text-base-content/40">{comma}</span>
    </div>
  );
}

function TreeNode({ keyName, value, isLast = true, depth, initialFoldDepth }: TreeNodeProps) {
  const copy = useTreeCopy();
  const [folded, setFolded] = useState(depth >= initialFoldDepth);
  const [copiedNode, setCopiedNode] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);

  const comma = isLast ? "" : ",";
  const indentStr = "  ".repeat(depth);

  const handleCopyNode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const textToCopy = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      await navigator.clipboard.writeText(textToCopy);
      setCopiedNode(true);
      setTimeout(() => setCopiedNode(false), 1200);
    } catch (err) {
      console.error("Failed to copy node:", err);
    }
  };

  const renderGutter = (collapsible: boolean) => {
    if (collapsible) {
      return (
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          className="inline-flex items-center justify-center w-3.5 h-3.5 mr-1 rounded text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors cursor-pointer select-none shrink-0"
          title={folded ? copy.expand : copy.collapse}
        >
          {folded ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
        </button>
      );
    }
    return <span className="inline-block w-3.5 h-3.5 mr-1 shrink-0 select-none" />;
  };

  const renderKey =
    keyName !== undefined ? (
      <span className="text-sky-600 dark:text-sky-400 font-semibold select-text">"{keyName}": </span>
    ) : null;

  if (value === null) {
    return (
      <div className="leading-relaxed whitespace-pre-wrap flex items-center group/node">
        <span className="select-none whitespace-pre">{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span className="text-rose-500 dark:text-rose-400 font-bold">null</span>
        <span className="text-base-content/40">{comma}</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div className="leading-relaxed whitespace-pre-wrap flex items-center group/node">
        <span className="select-none whitespace-pre">{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span className="text-amber-600 dark:text-amber-400 font-semibold">{value ? "true" : "false"}</span>
        <span className="text-base-content/40">{comma}</span>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="leading-relaxed whitespace-pre-wrap flex items-center group/node">
        <span className="select-none whitespace-pre">{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span className="text-amber-600 dark:text-amber-400 tabular-nums">{value}</span>
        <span className="text-base-content/40">{comma}</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <StringValueNode
        indentStr={indentStr}
        renderGutter={renderGutter}
        renderKey={renderKey}
        value={value}
        comma={comma}
      />
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as object);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  if (entries.length === 0) {
    return (
      <div className="leading-relaxed whitespace-pre-wrap flex items-center">
        <span className="select-none whitespace-pre">{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span className="text-base-content/60 font-semibold">
          {openBracket}
          {closeBracket}
        </span>
        <span className="text-base-content/40">{comma}</span>
      </div>
    );
  }

  const renderedEntries = entries.slice(0, visibleCount);
  const hasMore = entries.length > visibleCount;

  return (
    <div className="group/parent min-w-0">
      <div className="leading-relaxed whitespace-pre-wrap flex items-center flex-wrap">
        <span className="select-none whitespace-pre">{indentStr}</span>
        {renderGutter(true)}
        {renderKey}
        <span className="text-base-content/70 font-semibold">{openBracket}</span>

        <button
          type="button"
          onClick={handleCopyNode}
          className="inline-flex items-center justify-center p-0.5 ml-1 rounded text-base-content/30 hover:text-primary hover:bg-base-200 transition-all cursor-pointer opacity-0 group-hover/parent:opacity-100"
          title={copy.copyNode}
        >
          {copiedNode ? <Check className="w-3 h-3 text-success shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
        </button>

        {folded && (
          <button
            type="button"
            onClick={() => setFolded(false)}
            className="text-[10px] text-base-content/40 hover:text-base-content font-sans px-1.5 py-0.2 ml-1.5 rounded bg-base-200/60 cursor-pointer border border-base-300/40"
          >
            ... {entries.length} {isArray ? "items" : "keys"}
          </button>
        )}

        {folded && (
          <>
            <span className="text-base-content/70 font-semibold ml-1">{closeBracket}</span>
            <span className="text-base-content/40">{comma}</span>
          </>
        )}
      </div>

      {!folded && (
        <div className="min-w-0">
          {renderedEntries.map(([key, itemValue], index) => (
            <MemoTreeNode
              key={key}
              keyName={isArray ? undefined : key}
              value={itemValue}
              isLast={index === entries.length - 1 && !hasMore}
              depth={depth + 1}
              initialFoldDepth={initialFoldDepth}
            />
          ))}

          {hasMore && (
            <div className="leading-relaxed whitespace-pre-wrap flex items-center gap-2 my-1">
              <span className="select-none whitespace-pre">{indentStr} </span>
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + CHUNK_SIZE)}
                className="text-[10px] text-primary hover:underline font-sans px-2 py-0.5 rounded bg-base-200/80 cursor-pointer border border-base-300/50"
              >
                {copy.showMore(Math.min(CHUNK_SIZE, entries.length - visibleCount), entries.length - visibleCount)}
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(entries.length)}
                className="text-[10px] text-base-content/60 hover:text-base-content font-sans px-2 py-0.5 rounded bg-base-200/40 cursor-pointer"
              >
                {copy.showAllItems(entries.length)}
              </button>
            </div>
          )}

          <div className="leading-relaxed whitespace-pre-wrap flex items-center">
            <span className="select-none whitespace-pre">{indentStr}</span>
            {renderGutter(false)}
            <span className="text-base-content/70 font-semibold">{closeBracket}</span>
            <span className="text-base-content/40">{comma}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const MemoTreeNode = memo(TreeNode);
