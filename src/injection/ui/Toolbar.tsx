import { ChevronLeft, Minimize2, Pin } from "lucide-react";
import type { InjectionAppState } from "../hooks/useInjectionAppState";
import { useInjectionCopy } from "../i18n";
import { StatusDot } from "./StatusDot";

type State = Pick<
  InjectionAppState,
  | "dragOffset"
  | "setDragOffset"
  | "status"
  | "mockedRequests"
  | "apiTrafficLogs"
  | "currentPagePolicies"
  | "isInspectMode"
  | "isDocked"
  | "setIsDocked"
  | "isHovered"
  | "isDragging"
  | "isCompact"
  | "setIsCompact"
  | "handleMouseEnter"
  | "handleMouseLeave"
  | "handleDragStart"
  | "hasMoved"
  | "editingElement"
  | "isPrxPopoverOpen"
  | "setIsPrxPopoverOpen"
  | "isMockListOpen"
  | "setIsMockListOpen"
  | "isLogPopoverOpen"
  | "setIsLogPopoverOpen"
  | "isGuideModalOpen"
  | "setIsGuideModalOpen"
  | "closeAllPopovers"
>;

export function Toolbar({ s }: { s: State }) {
  const t = useInjectionCopy();
  return (
    <>
      {s.isDocked && !s.isHovered && !s.editingElement && (
        <div
          style={{
            position: "fixed",
            bottom: `${s.dragOffset.y}px`,
            right: "0px",
            zIndex: 2147483647,
            pointerEvents: "auto",
            backgroundColor: "var(--wt-bg-panel-translucent)",
            padding: "8px 12px",
            borderRadius: "100px 0 0 100px",
            border: "1px solid var(--wt-border-translucent)",
            borderRight: "none",
            boxShadow: "var(--wt-shadow)",
            color: "var(--wt-text-main)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "sans-serif",
            userSelect: "none",
            touchAction: "none",
            transition: "all 0.2s ease-in-out",
          }}
          onMouseEnter={s.handleMouseEnter}
          onMouseDown={s.handleDragStart}
          onTouchStart={s.handleDragStart}
          onClick={(e) => {
            if (!s.hasMoved.current) {
              e.stopPropagation();
              s.setIsDocked(false);
              s.setDragOffset({ x: 24, y: s.dragOffset.y });
            }
          }}
          title={t.toolbarDockHint}
        >
          <ChevronLeft style={{ width: "14px", height: "14px", color: "var(--color-warning, #f59e0b)" }} />
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor:
                s.mockedRequests.length > 0
                  ? "var(--color-warning, #f59e0b)"
                  : s.status.proxy
                    ? "var(--color-success, #10b981)"
                    : "var(--wt-text-faint)",
              boxShadow: s.mockedRequests.length > 0 ? "0 0 8px var(--color-warning, #f59e0b)" : "none",
            }}
          />
        </div>
      )}

      {/* Full Status Bar */}
      {!s.editingElement && (!s.isDocked || s.isHovered) && (
        <div
          style={{
            position: "fixed",
            bottom: `${s.dragOffset.y}px`,
            right: s.isDocked ? "0px" : `${s.dragOffset.x}px`,
            zIndex: 2147483647,
            pointerEvents: "auto",
            transition: s.isDragging ? "none" : "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseEnter={s.handleMouseEnter}
          onMouseLeave={s.handleMouseLeave}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              backgroundColor: "var(--wt-bg-panel-translucent)",
              padding: "4px 8px",
              borderRadius: s.isDocked ? "100px 0 0 100px" : "100px",
              border: "1px solid var(--wt-border-translucent)",
              borderRight: s.isDocked ? "none" : "1px solid var(--wt-border-translucent)",
              boxShadow: "var(--wt-shadow)",
              color: "var(--wt-text-main)",
              fontFamily: "sans-serif",
              cursor: s.isDragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
            onMouseDown={s.handleDragStart}
            onTouchStart={s.handleDragStart}
          >
            {s.isCompact ? (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  s.setIsCompact(false);
                }}
                title={t.toolbarExpand}
                style={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px 6px",
                }}
              >
                <ChevronLeft style={{ width: "14px", height: "14px", color: "var(--color-primary)" }} />
              </div>
            ) : (
              <div
                style={{ display: "flex", gap: "8px", padding: "2px 4px", userSelect: "none", alignItems: "center" }}
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !s.isPrxPopoverOpen;
                    s.closeAllPopovers();
                    s.setIsPrxPopoverOpen(next);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={t.toolbarProxy}
                >
                  <StatusDot
                    active={s.status.proxy}
                    color="#10b981"
                    label={s.status.proxy && (s.status.proxyCount ?? 0) > 0 ? `PRX (${s.status.proxyCount})` : "PRX"}
                  />
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !s.isMockListOpen;
                    s.closeAllPopovers();
                    s.setIsMockListOpen(next);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={t.toolbarMocks}
                >
                  <StatusDot
                    active={s.mockedRequests.length > 0}
                    color="#f59e0b"
                    label={s.mockedRequests.length > 0 ? `MCK (${s.mockedRequests.length})` : "MCK"}
                  />
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !s.isLogPopoverOpen;
                    s.closeAllPopovers();
                    s.setIsLogPopoverOpen(next);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={t.toolbarLogs}
                >
                  <StatusDot
                    active={s.apiTrafficLogs.length > 0}
                    color="#3b82f6"
                    label={s.apiTrafficLogs.length > 0 ? `LOG (${s.apiTrafficLogs.length})` : "LOG"}
                  />
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !s.isGuideModalOpen;
                    s.closeAllPopovers();
                    s.setIsGuideModalOpen(next);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={t.toolbarGuides}
                >
                  <StatusDot
                    active={s.currentPagePolicies.length > 0 || s.isInspectMode}
                    color="#ec4899"
                    label={s.currentPagePolicies.length > 0 ? `GUIDE (${s.currentPagePolicies.length})` : "GUIDE"}
                  />
                </div>

                {/* Dock & Compact Quick Controls */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    borderLeft: "1px solid var(--wt-border-translucent)",
                    paddingLeft: "6px",
                    marginLeft: "2px",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      s.setIsDocked(true);
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
                    title={t.toolbarHideEdge}
                  >
                    <Pin style={{ width: "12px", height: "12px" }} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      s.setIsCompact(true);
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
                    title={t.toolbarCompact}
                  >
                    <Minimize2 style={{ width: "12px", height: "12px" }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
