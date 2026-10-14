import { X } from "lucide-react";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";
import type { MockedApiEntry, MockRule } from "../types";

type State = Pick<
  InjectionAppState,
  | "dragOffset"
  | "backendMockRules"
  | "mockedRequests"
  | "setEditingMockRule"
  | "handleToggleAllMockRules"
  | "handleToggleMockRule"
  | "handleDeleteMockRule"
  | "closeAllPopovers"
>;

export function MockListPopover({ s }: { s: State }) {
  const t = useInjectionCopy();
  return (
    <div
      style={{
        position: "fixed",
        right: `${s.dragOffset.x}px`,
        bottom: `${s.dragOffset.y + 48}px`,
        width: "380px",
        maxHeight: "65vh",
        backgroundColor: "var(--wt-bg-panel)",
        borderRadius: "16px",
        border: "1px solid rgba(245, 158, 11, 0.4)",
        boxShadow: "var(--wt-shadow)",
        color: "var(--wt-text-main)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 2147483647,
        fontFamily: "sans-serif",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--wt-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "rgba(245, 158, 11, 0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span style={{ fontWeight: "700", fontSize: "13px", color: "#f59e0b" }}>
            {t.mocksTitle(s.backendMockRules.length > 0 ? s.backendMockRules.length : s.mockedRequests.length)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            onClick={() =>
              s.setEditingMockRule({
                name: `New Mock Rule`,
                method: "GET",
                url_pattern: `${window.location.origin}/api/*`,
                response_status: 200,
                response_body: '{\n  "mocked": true\n}',
                enabled: true,
              })
            }
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.5)",
              color: "#f59e0b",
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "10px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t.add}
            </span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              s.closeAllPopovers();
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--wt-text-muted)",
              cursor: "pointer",
              padding: "2px 4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
            }}
            title={t.close}
          >
            <X style={{ width: "16px", height: "16px" }} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--wt-border)",
          backgroundColor: "var(--wt-bg-subtle)",
          fontSize: "11px",
        }}
      >
        <span style={{ color: "var(--wt-text-muted)" }}>{t.mockAll}</span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => s.handleToggleAllMockRules(true)}
            style={{
              backgroundColor: "rgba(16, 185, 129, 0.15)",
              border: "1px solid #10b981",
              color: "#10b981",
              fontSize: "9px",
              fontWeight: "800",
              padding: "2px 6px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {t.mockAllOn}
          </button>
          <button
            type="button"
            onClick={() => s.handleToggleAllMockRules(false)}
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid #ef4444",
              color: "#ef4444",
              fontSize: "9px",
              fontWeight: "800",
              padding: "2px 6px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {t.mockAllOff}
          </button>
        </div>
      </div>

      {s.backendMockRules.length === 0 && s.mockedRequests.length === 0 ? (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--wt-text-muted)", fontSize: "12px" }}>
          {t.noPageMocks}
        </div>
      ) : (
        <div style={{ overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {(s.backendMockRules.length > 0 ? s.backendMockRules : s.mockedRequests).map((ruleOrReq) => {
            const isBackendRule = "url_pattern" in ruleOrReq;
            const rule = ruleOrReq as MockRule;
            const req = ruleOrReq as MockedApiEntry;

            const ruleId = isBackendRule ? rule.id : req.id;
            const method = isBackendRule ? rule.method : req.method;
            const url = isBackendRule ? rule.url_pattern : req.url;
            const enabled = isBackendRule ? rule.enabled : false;

            return (
              <div
                key={ruleId}
                style={{
                  backgroundColor: "var(--wt-bg-card)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  fontSize: "11px",
                  border: "1px solid var(--wt-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        backgroundColor:
                          method === "GET" ? "var(--color-primary, #3b82f6)" : "var(--color-success, #10b981)",
                        color: "var(--color-primary-content, white)",
                        fontSize: "9px",
                        fontWeight: "900",
                        padding: "1px 5px",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    >
                      {method}
                    </span>
                    {isBackendRule && (
                      <span
                        style={{
                          backgroundColor: enabled ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: enabled ? "#10b981" : "#ef4444",
                          fontSize: "9px",
                          fontWeight: "800",
                          padding: "1px 5px",
                          borderRadius: "4px",
                        }}
                      >
                        {rule.response_status || 200}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isBackendRule) {
                          s.setEditingMockRule(rule);
                        } else {
                          s.setEditingMockRule({
                            name: `Mock for ${req.ruleName || req.url.split("/").pop() || "API"}`,
                            method: req.method,
                            url_pattern: req.url.split("?")[0],
                            response_status: 200,
                            response_body: '{\n  "mocked": true\n}',
                            enabled: true,
                          });
                        }
                      }}
                      style={{
                        backgroundColor: "var(--wt-bg-subtle)",
                        border: "1px solid var(--wt-border)",
                        color: "var(--wt-text-main)",
                        fontSize: "9px",
                        fontWeight: "800",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title={t.mockEdit}
                    >
                      {t.mockEdit}
                    </button>
                    <button
                      type="button"
                      onClick={() => s.handleToggleMockRule(ruleOrReq, !enabled)}
                      style={{
                        backgroundColor: enabled ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.1)",
                        border: `1px solid ${enabled ? "#10b981" : "rgba(255,255,255,0.2)"}`,
                        color: enabled ? "#10b981" : "rgba(255,255,255,0.6)",
                        fontSize: "9px",
                        fontWeight: "800",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      {enabled ? "ON" : "OFF"}
                    </button>
                    {isBackendRule && (
                      <button
                        type="button"
                        onClick={() => s.handleDeleteMockRule(rule.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          padding: "2px",
                          display: "inline-flex",
                          alignItems: "center",
                          marginLeft: "2px",
                        }}
                        title={t.delete}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "11px",
                    wordBreak: "break-all",
                    color: "var(--wt-text-main)",
                    fontWeight: "600",
                  }}
                >
                  {url}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
