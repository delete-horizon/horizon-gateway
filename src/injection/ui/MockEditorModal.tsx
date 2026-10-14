import { X } from "lucide-react";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";
import { JsonViewer } from "./JsonViewer";

type State = Pick<
  InjectionAppState,
  | "editingMockRule"
  | "setEditingMockRule"
  | "mockTab"
  | "setMockTab"
  | "handleToggleMockRule"
  | "handleDeleteMockRule"
  | "handleSaveMockRule"
>;

export function MockEditorModal({ s }: { s: State }) {
  const t = useInjectionCopy();
  const editingMockRule = s.editingMockRule;
  if (!editingMockRule) {
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
          width: "600px",
          maxHeight: "88vh",
          backgroundColor: "var(--wt-bg-panel)",
          borderRadius: "16px",
          border: "1px solid rgba(245, 158, 11, 0.5)",
          boxShadow: "var(--wt-shadow)",
          padding: "20px",
          color: "var(--wt-text-main)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#f59e0b" }}>
              {editingMockRule.id ? t.mockEditTitle : t.mockNewTitle}
            </h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                const nextState = !(editingMockRule.enabled ?? true);
                s.setEditingMockRule({ ...editingMockRule, enabled: nextState });
                if (editingMockRule.id) {
                  s.handleToggleMockRule(editingMockRule.id, nextState);
                }
              }}
              style={{
                backgroundColor:
                  (editingMockRule.enabled ?? true) ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${(editingMockRule.enabled ?? true) ? "#10b981" : "#ef4444"}`,
                color: (editingMockRule.enabled ?? true) ? "#10b981" : "#ef4444",
                fontSize: "11px",
                fontWeight: "800",
                padding: "2px 8px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {(editingMockRule.enabled ?? true) ? t.mockOn : t.mockOff}
            </button>
            <button
              type="button"
              onClick={() => s.setEditingMockRule(null)}
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
            >
              <X style={{ width: "16px", height: "16px" }} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>{t.ruleName}</label>
          <input
            type="text"
            value={editingMockRule.name || ""}
            onChange={(e) => s.setEditingMockRule({ ...editingMockRule, name: e.target.value })}
            placeholder={t.ruleNamePlaceholder}
            style={{
              padding: "7px 10px",
              borderRadius: "6px",
              backgroundColor: "var(--wt-bg-card)",
              border: "1px solid var(--wt-border)",
              color: "var(--wt-text-main)",
              fontSize: "12px",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100px" }}>
            <label style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>Method</label>
            <select
              value={editingMockRule.method || "GET"}
              onChange={(e) => s.setEditingMockRule({ ...editingMockRule, method: e.target.value })}
              style={{
                padding: "6px 8px",
                borderRadius: "6px",
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                color: "var(--wt-text-main)",
                fontSize: "12px",
              }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
              <option value="*">* (ANY)</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "110px" }}>
            <label style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>{t.statusCode}</label>
            <input
              type="number"
              value={editingMockRule.response_status || 200}
              onChange={(e) =>
                s.setEditingMockRule({ ...editingMockRule, response_status: Number.parseInt(e.target.value, 10) })
              }
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                color: "var(--wt-text-main)",
                fontSize: "12px",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
            <label style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>{t.delayMs}</label>
            <input
              type="number"
              value={editingMockRule.delay_ms || 0}
              onChange={(e) =>
                s.setEditingMockRule({ ...editingMockRule, delay_ms: Number.parseInt(e.target.value, 10) || 0 })
              }
              placeholder="0"
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                color: "var(--wt-text-main)",
                fontSize: "12px",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ fontSize: "11px", color: "var(--wt-text-muted)" }}>{t.urlPattern}</label>
          <input
            type="text"
            value={editingMockRule.url_pattern || ""}
            onChange={(e) => s.setEditingMockRule({ ...editingMockRule, url_pattern: e.target.value })}
            placeholder={t.urlPatternPlaceholder}
            style={{
              padding: "7px 10px",
              borderRadius: "6px",
              backgroundColor: "var(--wt-bg-card)",
              border: "1px solid var(--wt-border)",
              color: "var(--color-primary, #38bdf8)",
              fontSize: "12px",
              fontFamily: "monospace",
            }}
          />
        </div>

        {/* Response Body Tabs */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "11px", color: "var(--wt-text-muted)", fontWeight: "600" }}>
              {t.responseBody}
            </label>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                type="button"
                onClick={() => s.setMockTab("edit")}
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: s.mockTab === "edit" ? "rgba(245, 158, 11, 0.2)" : "var(--wt-bg-subtle)",
                  border: s.mockTab === "edit" ? "1px solid #f59e0b" : "1px solid var(--wt-border)",
                  color: s.mockTab === "edit" ? "#f59e0b" : "var(--wt-text-muted)",
                  fontSize: "10px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                {t.editDirect}
              </button>
              <button
                type="button"
                onClick={() => s.setMockTab("preview")}
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: s.mockTab === "preview" ? "rgba(245, 158, 11, 0.2)" : "var(--wt-bg-subtle)",
                  border: s.mockTab === "preview" ? "1px solid #f59e0b" : "1px solid var(--wt-border)",
                  color: s.mockTab === "preview" ? "#f59e0b" : "var(--wt-text-muted)",
                  fontSize: "10px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                {t.foldableView}
              </button>
            </div>
          </div>

          {s.mockTab === "edit" ? (
            <textarea
              value={editingMockRule.response_body || ""}
              onChange={(e) => s.setEditingMockRule({ ...editingMockRule, response_body: e.target.value })}
              rows={8}
              placeholder={t.responsePlaceholder}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                color: "var(--color-primary, #38bdf8)",
                fontSize: "11px",
                fontFamily: "monospace",
                resize: "vertical",
                lineHeight: "1.5",
              }}
            />
          ) : (
            <JsonViewer src={editingMockRule.response_body || "{}"} />
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            justifyContent: "space-between",
            marginTop: "8px",
            alignItems: "center",
          }}
        >
          {editingMockRule.id ? (
            <button
              type="button"
              onClick={() => {
                if (editingMockRule.id) {
                  s.handleDeleteMockRule(editingMockRule.id);
                  s.setEditingMockRule(null);
                }
              }}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                color: "var(--color-error, #ef4444)",
                fontSize: "12px",
                fontWeight: "800",
                cursor: "pointer",
              }}
            >
              {t.deleteMock}
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => s.setEditingMockRule(null)}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                backgroundColor: "var(--wt-bg-subtle)",
                border: "1px solid var(--wt-border)",
                color: "var(--wt-text-main)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                s.handleSaveMockRule(editingMockRule);
                s.setEditingMockRule(null);
              }}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                backgroundColor: "#f59e0b",
                border: "none",
                color: "black",
                fontSize: "12px",
                fontWeight: "800",
                cursor: "pointer",
              }}
            >
              {t.saveMock}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
