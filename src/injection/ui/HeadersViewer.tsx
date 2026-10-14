import { useInjectionCopy } from "../i18n";

export function HeadersViewer({ headers }: { headers?: Record<string, string> }) {
  const t = useInjectionCopy();
  if (!headers || Object.keys(headers).length === 0) {
    return <div style={{ fontSize: "11px", color: "var(--wt-text-faint)", fontStyle: "italic" }}>{t.noHeaders}</div>;
  }

  return (
    <div
      style={{
        backgroundColor: "var(--wt-bg-card)",
        padding: "8px 12px",
        borderRadius: "8px",
        border: "1px solid var(--wt-border)",
        overflowY: "auto",
        maxHeight: "220px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontFamily: "monospace",
        fontSize: "11px",
      }}
    >
      {Object.entries(headers).map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: "8px", wordBreak: "break-all" }}>
          <span style={{ color: "var(--color-primary, #38bdf8)", fontWeight: "700", minWidth: "120px", flexShrink: 0 }}>
            {k}:
          </span>
          <span style={{ color: "var(--wt-text-main)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
