import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useInjectionCopy } from "../i18n";
import { parsePartialJson } from "../lib/json";

export function JsonViewer({ src }: { src: string }) {
  const t = useInjectionCopy();
  const [parsed, setParsed] = useState<unknown | null>(null);
  const [isError, setIsError] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const res = parsePartialJson(src);
    if (res.data !== null) {
      setParsed(res.data);
      setIsTruncated(res.truncated);
      setIsError(false);
    } else {
      setIsError(true);
      setIsTruncated(res.truncated);
    }
  }, [src]);

  const formattedRawJson = useMemo(() => {
    if (parsed !== null) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch (_e) {
        return src;
      }
    }
    return src;
  }, [parsed, src]);

  if (isError || parsed === null) {
    return (
      <pre
        style={{
          backgroundColor: "var(--wt-bg-card)",
          padding: "10px",
          borderRadius: "8px",
          border: "1px solid var(--wt-border)",
          color: "var(--color-primary, #38bdf8)",
          fontSize: "11px",
          fontFamily: "monospace",
          overflowY: "auto",
          maxHeight: "340px",
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          userSelect: "text",
        }}
      >
        {src}
      </pre>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: "var(--wt-text-muted)", fontWeight: "600" }}>
          {t.jsonHint}
          {isTruncated && (
            <span style={{ color: "var(--color-warning, #f59e0b)", marginLeft: "6px" }}>{t.jsonTruncated}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(formattedRawJson);
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1500);
          }}
          style={{
            backgroundColor: "var(--wt-bg-subtle)",
            border: "1px solid var(--wt-border)",
            color: copiedAll ? "var(--color-success, #10b981)" : "var(--color-primary, #38bdf8)",
            fontSize: "10px",
            padding: "3px 8px",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "700",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {copiedAll ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
          {copiedAll ? t.jsonCopied : t.copyJson}
        </button>
      </div>

      <div
        style={{
          backgroundColor: "var(--wt-bg-card)",
          padding: "10px",
          borderRadius: "8px",
          border: "1px solid var(--wt-border)",
          overflowY: "auto",
          maxHeight: "340px",
          fontFamily: "monospace",
          fontSize: "11px",
          lineHeight: "1.6",
          color: "var(--wt-text-main)",
          userSelect: "text",
        }}
      >
        <TreeJsonNode value={parsed} isLast={true} depth={0} />
      </div>
    </div>
  );
}

function TreeJsonNode({
  keyName,
  value,
  isLast = true,
  depth = 0,
}: {
  keyName?: string;
  value: unknown;
  isLast?: boolean;
  depth?: number;
}) {
  const t = useInjectionCopy();
  const [folded, setFolded] = useState(depth >= 2);
  const [copiedNode, setCopiedNode] = useState(false);
  const comma = isLast ? "" : ",";
  const indentStr = "  ".repeat(depth);

  const renderKey =
    keyName !== undefined ? <span style={{ color: "#38bdf8", fontWeight: "600" }}>"{keyName}": </span> : null;

  const handleCopyThisNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const textToCopy = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      navigator.clipboard.writeText(textToCopy);
      setCopiedNode(true);
      setTimeout(() => setCopiedNode(false), 1200);
    } catch (_e) {}
  };

  const renderGutter = (collapsible: boolean) => {
    if (collapsible) {
      return (
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            userSelect: "none",
            color: "#cbd5e1",
            fontWeight: "700",
            fontSize: "10px",
            marginRight: "4px",
            width: "12px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            verticalAlign: "middle",
          }}
          title={folded ? t.expand : t.collapse}
        >
          {folded ? "▶" : "▼"}
        </button>
      );
    }
    return <span style={{ display: "inline-block", width: "12px", marginRight: "4px", verticalAlign: "middle" }} />;
  };

  if (value === null) {
    return (
      <div
        style={{ display: "flex", alignItems: "center", userSelect: "text", lineHeight: "1.6", whiteSpace: "pre-wrap" }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span style={{ color: "#ef4444", fontWeight: "700" }}>null</span>
        {comma}
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <div
        style={{ display: "flex", alignItems: "center", userSelect: "text", lineHeight: "1.6", whiteSpace: "pre-wrap" }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span style={{ color: "#f59e0b", fontWeight: "700" }}>{value ? "true" : "false"}</span>
        {comma}
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <div
        style={{ display: "flex", alignItems: "center", userSelect: "text", lineHeight: "1.6", whiteSpace: "pre-wrap" }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span style={{ color: "#f59e0b" }}>{value}</span>
        {comma}
      </div>
    );
  }
  if (typeof value === "string") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          userSelect: "text",
          lineHeight: "1.6",
          whiteSpace: "pre-wrap",
        }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span style={{ color: "#a3e635" }}>"{value}"</span>
        {comma}
      </div>
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
      <div
        style={{ display: "flex", alignItems: "center", userSelect: "text", lineHeight: "1.6", whiteSpace: "pre-wrap" }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(false)}
        {renderKey}
        <span style={{ color: "#94a3b8" }}>
          {openBracket}
          {closeBracket}
        </span>
        {comma}
      </div>
    );
  }

  return (
    <div style={{ display: "block", userSelect: "text" }}>
      {/* Object Header Line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          userSelect: "text",
          lineHeight: "1.6",
          whiteSpace: "pre-wrap",
        }}
      >
        <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
        {renderGutter(true)}
        {renderKey}
        <span style={{ color: "#cbd5e1", fontWeight: "700" }}>{openBracket}</span>

        {/* Node Level Copy Button */}
        <button
          type="button"
          onClick={handleCopyThisNode}
          style={{
            background: "none",
            border: "none",
            padding: "0 2px",
            fontSize: "9px",
            color: copiedNode ? "#10b981" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontWeight: "600",
            marginLeft: "4px",
            userSelect: "none",
            display: "inline-flex",
            alignItems: "center",
            verticalAlign: "middle",
          }}
          title={t.copyNode}
        >
          {copiedNode ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
        </button>

        {folded && (
          <span
            onClick={() => setFolded(false)}
            style={{
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: "600",
              marginLeft: "6px",
              padding: "0 4px",
              borderRadius: "4px",
              backgroundColor: "rgba(255,255,255,0.06)",
              userSelect: "none",
            }}
          >
            ... {entries.length} {isArray ? "items" : "keys"}
          </span>
        )}
        {folded && (
          <span style={{ color: "#cbd5e1", fontWeight: "700", marginLeft: "4px" }}>
            {closeBracket}
            {comma}
          </span>
        )}
      </div>

      {!folded && (
        <div style={{ display: "block", userSelect: "text" }}>
          {entries.map(([k, v], idx) => (
            <TreeJsonNode
              key={k}
              keyName={isArray ? undefined : k}
              value={v}
              isLast={idx === entries.length - 1}
              depth={depth + 1}
            />
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              userSelect: "text",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
            }}
          >
            <span style={{ whiteSpace: "pre", userSelect: "text" }}>{indentStr}</span>
            {renderGutter(false)}
            <span style={{ color: "#cbd5e1", fontWeight: "700" }}>{closeBracket}</span>
            {comma}
          </div>
        </div>
      )}
    </div>
  );
}
