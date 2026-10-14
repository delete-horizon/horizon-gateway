import { X } from "lucide-react";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";

type State = Pick<
  InjectionAppState,
  | "dragOffset"
  | "status"
  | "showAllProxyRoutes"
  | "setShowAllProxyRoutes"
  | "proxyRoutes"
  | "matchedProxyRoutes"
  | "handleToggleProxyRoute"
  | "closeAllPopovers"
>;

export function PrxPopover({ s }: { s: State }) {
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
        border: "1px solid rgba(16, 185, 129, 0.4)",
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
          backgroundColor: "rgba(16, 185, 129, 0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span style={{ fontWeight: "700", fontSize: "13px", color: "#10b981" }}>{t.proxyTitle}</span>
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
      <div
        style={{
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          fontSize: "12px",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "var(--wt-bg-card)",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--wt-border)",
          }}
        >
          <span style={{ color: "var(--wt-text-muted)" }}>{t.proxyState}</span>
          <span
            style={{
              fontWeight: "700",
              color: s.status.proxy ? "var(--color-success, #10b981)" : "var(--color-error, #ef4444)",
            }}
          >
            {s.status.proxy ? t.proxyActive : t.proxyInactive}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "var(--wt-bg-card)",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--wt-border)",
          }}
        >
          <span style={{ color: "var(--wt-text-muted)" }}>{t.proxyTraffic}</span>
          <span style={{ fontWeight: "700", color: "var(--wt-text-main)" }}>
            {t.trafficCount(s.status.proxyCount ?? 0)}
          </span>
        </div>

        <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", color: "#10b981" }}>
              {s.showAllProxyRoutes ? t.allRoutes(s.proxyRoutes.length) : t.domainRoutes(s.matchedProxyRoutes.length)}
            </span>
            {s.proxyRoutes.length > 0 && (
              <button
                type="button"
                onClick={() => s.setShowAllProxyRoutes(!s.showAllProxyRoutes)}
                style={{
                  backgroundColor: "var(--wt-bg-subtle)",
                  border: "1px solid var(--wt-border)",
                  color: "var(--color-primary, #38bdf8)",
                  fontSize: "9px",
                  fontWeight: "700",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {s.showAllProxyRoutes ? t.thisDomainOnly : t.showAll(s.proxyRoutes.length)}
              </button>
            )}
          </div>

          {s.matchedProxyRoutes.length === 0 ? (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--wt-text-muted)", fontSize: "11px" }}>
              {s.showAllProxyRoutes ? t.noRoutes : t.noDomainRoutes(window.location.hostname)}
            </div>
          ) : (
            s.matchedProxyRoutes.map((route) => (
              <div
                key={route.id}
                style={{
                  backgroundColor: "var(--wt-bg-card)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  border: "1px solid var(--wt-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      fontWeight: "700",
                      fontSize: "11px",
                      color: "var(--wt-text-main)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {route.domain}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--color-primary, #38bdf8)", fontFamily: "monospace" }}>
                    ➔ {route.target_host}:{route.target_port}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => s.handleToggleProxyRoute(route.id, !route.enabled)}
                  style={{
                    backgroundColor: route.enabled ? "rgba(16, 185, 129, 0.15)" : "var(--wt-bg-subtle)",
                    border: `1px solid ${route.enabled ? "#10b981" : "var(--wt-border)"}`,
                    color: route.enabled ? "#10b981" : "var(--wt-text-muted)",
                    fontSize: "10px",
                    fontWeight: "800",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    marginLeft: "8px",
                    flexShrink: 0,
                  }}
                >
                  {route.enabled ? "ON" : "OFF"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
