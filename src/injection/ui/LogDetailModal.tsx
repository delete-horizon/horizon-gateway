import { ArrowUpRight, Copy, List, Sparkles, Terminal, X, Zap } from "lucide-react";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";
import { HeadersViewer } from "./HeadersViewer";
import { JsonViewer } from "./JsonViewer";

type State = Pick<
  InjectionAppState,
  | "selectedLogDetail"
  | "setSelectedLogDetail"
  | "activeDetailTab"
  | "setActiveDetailTab"
  | "setEditingMockRule"
  | "closeAllPopovers"
>;

export function LogDetailModal({ s }: { s: State }) {
  const t = useInjectionCopy();
  const selectedLogDetail = s.selectedLogDetail;
  if (!selectedLogDetail) {
    return null;
  }
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: "560px",
          maxHeight: "85vh",
          backgroundColor: "var(--wt-bg-panel)",
          borderRadius: "16px",
          border: "1px solid var(--wt-border-primary)",
          boxShadow: "var(--wt-shadow)",
          padding: "20px",
          color: "var(--wt-text-main)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                backgroundColor:
                  selectedLogDetail.method === "GET"
                    ? "var(--color-primary, #3b82f6)"
                    : "var(--color-success, #10b981)",
                color: "var(--color-primary-content, white)",
                fontSize: "10px",
                fontWeight: "900",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              {selectedLogDetail.method}
            </span>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "var(--wt-text-main)" }}>
              {t.logDetailTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => s.setSelectedLogDetail(null)}
            style={{
              background: "none",
              border: "none",
              color: "var(--wt-text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div
          style={{
            fontSize: "11px",
            color: "var(--wt-text-main)",
            wordBreak: "break-all",
            fontFamily: "monospace",
            backgroundColor: "var(--wt-bg-card)",
            border: "1px solid var(--wt-border)",
            padding: "8px",
            borderRadius: "6px",
          }}
        >
          {selectedLogDetail.url}
        </div>

        <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--wt-text-muted)" }}>
          <span>
            Status:{" "}
            <strong
              style={{
                color: selectedLogDetail.status < 300 ? "var(--color-success, #10b981)" : "var(--color-error, #ef4444)",
              }}
            >
              {selectedLogDetail.status}
            </strong>
          </span>
          <span>
            Latency: <strong>{selectedLogDetail.duration}ms</strong>
          </span>
          {selectedLogDetail.isMocked && <strong style={{ color: "var(--color-warning, #f59e0b)" }}>[MOCKED]</strong>}
        </div>

        {/* Modal Tabs */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            borderBottom: "1px solid var(--wt-border)",
            paddingBottom: "6px",
          }}
        >
          <button
            type="button"
            onClick={() => s.setActiveDetailTab("response")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: s.activeDetailTab === "response" ? "var(--wt-bg-active)" : "transparent",
              border: s.activeDetailTab === "response" ? "1px solid var(--color-primary, #3b82f6)" : "none",
              color: s.activeDetailTab === "response" ? "var(--color-primary, #60a5fa)" : "var(--wt-text-muted)",
              fontSize: "11px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Zap style={{ width: 12, height: 12 }} /> Response Body
          </button>
          <button
            type="button"
            onClick={() => s.setActiveDetailTab("request")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: s.activeDetailTab === "request" ? "var(--wt-bg-active)" : "transparent",
              border: s.activeDetailTab === "request" ? "1px solid var(--color-primary, #3b82f6)" : "none",
              color: s.activeDetailTab === "request" ? "var(--color-primary, #60a5fa)" : "var(--wt-text-muted)",
              fontSize: "11px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <ArrowUpRight style={{ width: 12, height: 12 }} /> Request Body {selectedLogDetail.requestBody ? "•" : ""}
          </button>
          <button
            type="button"
            onClick={() => s.setActiveDetailTab("headers")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: s.activeDetailTab === "headers" ? "var(--wt-bg-active)" : "transparent",
              border: s.activeDetailTab === "headers" ? "1px solid var(--color-primary, #3b82f6)" : "none",
              color: s.activeDetailTab === "headers" ? "var(--color-primary, #60a5fa)" : "var(--wt-text-muted)",
              fontSize: "11px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <List style={{ width: 12, height: 12 }} /> Headers
          </button>
        </div>

        {/* Tab Body Contents */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          {s.activeDetailTab === "response" &&
            (selectedLogDetail.responseBody ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>Response Data (Foldable Tree)</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(selectedLogDetail.responseBody || "")}
                    style={{
                      backgroundColor: "var(--wt-bg-subtle)",
                      border: "1px solid var(--wt-border)",
                      color: "var(--color-primary, #38bdf8)",
                      fontSize: "10px",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Copy style={{ width: 11, height: 11 }} /> {t.copyResponse}
                  </button>
                </div>
                <JsonViewer src={selectedLogDetail.responseBody} />
              </div>
            ) : (
              <div style={{ fontSize: "11px", color: "var(--wt-text-faint)", fontStyle: "italic" }}>
                {t.emptyResponse}
              </div>
            ))}

          {s.activeDetailTab === "request" &&
            (selectedLogDetail.requestBody ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>Request Data</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(selectedLogDetail.requestBody || "")}
                    style={{
                      backgroundColor: "var(--wt-bg-subtle)",
                      border: "1px solid var(--wt-border)",
                      color: "var(--color-primary, #38bdf8)",
                      fontSize: "10px",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Copy style={{ width: 11, height: 11 }} /> {t.copyRequest}
                  </button>
                </div>
                <JsonViewer src={selectedLogDetail.requestBody} />
              </div>
            ) : (
              <div style={{ fontSize: "11px", color: "var(--wt-text-faint)", fontStyle: "italic" }}>
                {t.emptyRequest}
              </div>
            ))}

          {s.activeDetailTab === "headers" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    color: "var(--color-primary, #38bdf8)",
                    marginBottom: "4px",
                  }}
                >
                  Request Headers
                </div>
                <HeadersViewer headers={selectedLogDetail.requestHeaders} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    color: "var(--color-success, #10b981)",
                    marginBottom: "4px",
                  }}
                >
                  Response Headers
                </div>
                <HeadersViewer headers={selectedLogDetail.responseHeaders} />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(selectedLogDetail.url)}
            style={{
              padding: "5px 10px",
              borderRadius: "6px",
              backgroundColor: "var(--wt-bg-subtle)",
              border: "1px solid var(--wt-border)",
              color: "var(--wt-text-main)",
              fontSize: "11px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Copy style={{ width: 12, height: 12 }} /> {t.copyUrl}
          </button>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(`curl -X ${selectedLogDetail.method} "${selectedLogDetail.url}"`)
            }
            style={{
              padding: "5px 10px",
              borderRadius: "6px",
              backgroundColor: "var(--wt-bg-subtle)",
              border: "1px solid var(--wt-border)",
              color: "var(--wt-text-main)",
              fontSize: "11px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Terminal style={{ width: 12, height: 12 }} /> {t.copyCurl}
          </button>
          <button
            type="button"
            onClick={() => {
              const cleanUrl = selectedLogDetail.url.split("?")[0];
              s.setEditingMockRule({
                name: `Mock for ${cleanUrl.split("/").pop() || "API"}`,
                method: selectedLogDetail.method,
                url_pattern: cleanUrl,
                response_status: selectedLogDetail.status || 200,
                response_body: selectedLogDetail.responseBody || '{\n  "mocked": true\n}',
                enabled: true,
              });
              s.setSelectedLogDetail(null);
              s.closeAllPopovers();
            }}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              backgroundColor: "#f59e0b",
              border: "none",
              color: "black",
              fontSize: "11px",
              fontWeight: "800",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Sparkles style={{ width: 13, height: 13 }} /> {t.createMockRule}
          </button>
        </div>
      </div>
    </div>
  );
}
