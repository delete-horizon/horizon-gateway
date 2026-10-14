import { Copy, Edit3, Eye, FileText, Pin, Search, Target, Trash2, X } from "lucide-react";
import { MarkdownRenderer } from "@/shared/lib/MarkdownRenderer";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";

type State = Pick<
  InjectionAppState,
  | "dragOffset"
  | "currentPagePolicies"
  | "isInspectMode"
  | "setIsInspectMode"
  | "showPolicyBadges"
  | "setShowPolicyBadges"
  | "setEditingAnnotation"
  | "copyDescription"
  | "copySelector"
  | "copySummary"
  | "deleteAnnotation"
  | "closeAllPopovers"
>;

export function GuideModal({ s }: { s: State }) {
  const t = useInjectionCopy();
  return (
    <div
      style={{
        position: "fixed",
        right: `${s.dragOffset.x}px`,
        bottom: `${s.dragOffset.y + 48}px`,
        minWidth: "320px",
        width: "max-content",
        maxWidth: "min(440px, calc(100vw - 32px))",
        maxHeight: "65vh",
        backgroundColor: "var(--wt-bg-panel)",
        borderRadius: "16px",
        border: "1px solid rgba(236, 72, 153, 0.4)",
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
          backgroundColor: "rgba(236, 72, 153, 0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Pin style={{ width: "15px", height: "15px", color: "#ec4899" }} />
          <span style={{ fontWeight: "700", fontSize: "13px", color: "#ec4899" }}>
            {t.guidesTitle(s.currentPagePolicies.length)}
          </span>
        </div>
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
            padding: "2px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title={t.close}
        >
          <X style={{ width: "16px", height: "16px" }} />
        </button>
      </div>

      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--wt-border)",
          backgroundColor: "var(--wt-bg-subtle)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            s.setIsInspectMode(!s.isInspectMode);
            s.closeAllPopovers();
          }}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: "8px",
            backgroundColor: s.isInspectMode ? "rgba(59, 130, 246, 0.2)" : "var(--wt-bg-card)",
            border: s.isInspectMode ? "1px solid var(--color-primary, #3b82f6)" : "1px solid var(--wt-border)",
            color: "var(--wt-text-main)",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          <Search
            style={{
              width: "13px",
              height: "13px",
              color: s.isInspectMode ? "var(--color-primary, #60a5fa)" : "var(--wt-text-muted)",
            }}
          />
          <span>{s.isInspectMode ? t.selecting : t.selectElement}</span>
        </button>
        <button
          type="button"
          onClick={() => s.setShowPolicyBadges(!s.showPolicyBadges)}
          style={{
            padding: "6px 10px",
            borderRadius: "8px",
            backgroundColor: s.showPolicyBadges ? "rgba(236, 72, 153, 0.2)" : "var(--wt-bg-card)",
            border: s.showPolicyBadges ? "1px solid #ec4899" : "1px solid var(--wt-border)",
            color: "var(--wt-text-main)",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Eye
            style={{ width: "13px", height: "13px", color: s.showPolicyBadges ? "#f472b6" : "var(--wt-text-muted)" }}
          />
          <span>{t.badges(s.showPolicyBadges)}</span>
        </button>
      </div>

      {s.currentPagePolicies.length === 0 ? (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--wt-text-muted)", fontSize: "12px" }}>
          {t.noGuides}
          <br />
          <span style={{ fontSize: "11px", opacity: 0.8, marginTop: "6px", display: "block" }}>{t.noGuidesHint}</span>
        </div>
      ) : (
        <div
          style={{
            overflowY: "auto",
            overflowX: "hidden",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {s.currentPagePolicies.map((ann, idx) => (
            <div
              key={ann.id}
              style={{
                background: "var(--wt-bg-card)",
                borderRadius: "12px",
                padding: "10px 12px",
                fontSize: "11px",
                border: "1px solid var(--wt-border)",
                boxShadow: "var(--wt-shadow)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                maxWidth: "100%",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      backgroundColor: "rgba(236, 72, 153, 0.15)",
                      color: "#ec4899",
                      fontSize: "9px",
                      fontWeight: "900",
                      padding: "2px 6px",
                      borderRadius: "6px",
                      border: "1px solid rgba(236, 72, 153, 0.3)",
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <span style={{ fontWeight: "700", color: "var(--wt-text-main)", fontSize: "12px" }}>{ann.role}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={() => s.setEditingAnnotation(ann)}
                    style={{
                      background: "var(--wt-bg-subtle)",
                      border: "1px solid var(--wt-border)",
                      borderRadius: "4px",
                      color: "#f472b6",
                      cursor: "pointer",
                      padding: "3px 6px",
                      fontSize: "10px",
                      fontWeight: "600",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                    title={t.edit}
                  >
                    <Edit3 style={{ width: "11px", height: "11px" }} />
                    <span>{t.edit}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => s.deleteAnnotation(ann.id, e)}
                    style={{
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: "4px",
                      color: "var(--color-error, #f87171)",
                      cursor: "pointer",
                      padding: "3px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title={t.delete}
                  >
                    <Trash2 style={{ width: "11px", height: "11px" }} />
                  </button>
                </div>
              </div>

              {ann.description && (
                <MarkdownRenderer
                  content={ann.description}
                  style={{ fontSize: "11px", color: "var(--wt-text-main)" }}
                  codeStyle={{
                    backgroundColor: "var(--wt-bg-subtle)",
                    color: "var(--color-primary, #a5b4fc)",
                    border: "1px solid var(--wt-border)",
                  }}
                />
              )}

              <div
                style={{
                  fontSize: "9.5px",
                  fontFamily: "monospace",
                  color: "var(--wt-text-muted)",
                  wordBreak: "break-all",
                }}
              >
                {ann.selector}
              </div>

              {/* Action Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--wt-border)",
                }}
              >
                <button
                  type="button"
                  onClick={(e) => s.copyDescription(ann, e)}
                  style={{
                    background: "var(--wt-bg-subtle)",
                    border: "1px solid var(--wt-border)",
                    borderRadius: "4px",
                    color: "var(--wt-text-main)",
                    cursor: "pointer",
                    padding: "3px 6px",
                    fontSize: "9.5px",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                  title={t.copyDescription}
                >
                  <Copy style={{ width: "10px", height: "10px", color: "var(--color-primary, #60a5fa)" }} />
                  <span>{t.copyDescription}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => s.copySelector(ann, e)}
                  style={{
                    background: "var(--wt-bg-subtle)",
                    border: "1px solid var(--wt-border)",
                    borderRadius: "4px",
                    color: "var(--wt-text-main)",
                    cursor: "pointer",
                    padding: "3px 6px",
                    fontSize: "9.5px",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                  title={t.copySelector}
                >
                  <Target style={{ width: "10px", height: "10px", color: "var(--color-success, #34d399)" }} />
                  <span>Selector</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => s.copySummary(ann, e)}
                  style={{
                    background: "var(--wt-bg-subtle)",
                    border: "1px solid var(--wt-border)",
                    borderRadius: "4px",
                    color: "var(--wt-text-main)",
                    cursor: "pointer",
                    padding: "3px 6px",
                    fontSize: "9.5px",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                  title={t.copySummary}
                >
                  <FileText style={{ width: "10px", height: "10px", color: "var(--color-warning, #fbbf24)" }} />
                  <span>{t.copySummary}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
