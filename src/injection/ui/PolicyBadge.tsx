import { ArrowUpCircle, Camera, Copy, Edit3, FileText, Pin, Target, Trash2, X } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, LocatorValidation } from "@/entities/inspector";
import { MarkdownRenderer } from "@/shared/lib/MarkdownRenderer";
import { useInjectionCopy } from "../i18n";
import { ensureLocators, resolveAnnotation } from "../lib/locator";

const STATUS_COLOR: Record<string, { bg: string; border: string; label: string }> = {
  ok: { bg: "var(--color-success, #22c55e)", border: "var(--color-success, #86efac)", label: "ok" },
  weak: { bg: "var(--color-warning, #f59e0b)", border: "var(--color-warning, #fcd34d)", label: "weak" },
  broken: { bg: "var(--color-error, #ef4444)", border: "var(--color-error, #fca5a5)", label: "broken" },
  ambiguous: { bg: "var(--color-secondary, #a855f7)", border: "var(--color-secondary, #d8b4fe)", label: "ambiguous" },
};

function isSameValidation(a: LocatorValidation | null, b: LocatorValidation | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.status !== b.status) {
    return false;
  }
  if (a.primaryMatches !== b.primaryMatches) {
    return false;
  }
  if (a.resolvedBy !== b.resolvedBy) {
    return false;
  }
  if (a.suggestPromoteTo !== b.suggestPromoteTo) {
    return false;
  }
  if (a.fallbackMatches.length !== b.fallbackMatches.length) {
    return false;
  }
  for (let i = 0; i < a.fallbackMatches.length; i++) {
    if (a.fallbackMatches[i] !== b.fallbackMatches[i]) {
      return false;
    }
  }
  return true;
}

export interface PolicyBadgeGroupItem {
  annotation: Annotation;
  index: number;
}

export function PolicyBadge({
  annotation: singleAnnotation,
  index,
  items,
  isActive,
  onToggle,
  onEdit,
  onCopyDescription,
  onCopySelector,
  onCopySummary,
  onDelete,
  onPromote,
  onValidation,
  onRecapture,
}: {
  annotation?: Annotation;
  index?: number;
  items?: PolicyBadgeGroupItem[];
  isActive: boolean;
  onToggle: () => void;
  onEdit?: (ann: Annotation) => void;
  onCopyDescription?: (ann: Annotation) => void;
  onCopySelector?: (ann: Annotation) => void;
  onCopySummary?: (ann: Annotation) => void;
  onDelete?: (id: string) => void;
  onPromote?: (ann: Annotation, promoteIndex: number) => void;
  onValidation?: (ann: Annotation, validation: LocatorValidation) => void;
  onRecapture?: (ann: Annotation) => void | Promise<void>;
}) {
  const badgeItems: PolicyBadgeGroupItem[] =
    items && items.length > 0
      ? items
      : singleAnnotation && index != null
        ? [{ annotation: singleAnnotation, index }]
        : [];

  const [activeSubIndex, setActiveSubIndex] = useState(0);
  const [confirmRecapture, setConfirmRecapture] = useState(false);
  const [isRecapturing, setIsRecapturing] = useState(false);
  const confirmRecaptureTimer = useRef<number | null>(null);
  const t = useInjectionCopy();
  const currentItem = badgeItems[activeSubIndex] || badgeItems[0];
  const targetAnnotation = currentItem?.annotation;
  const primaryAnnotation = badgeItems[0]?.annotation;

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [validation, setValidation] = useState<LocatorValidation | null>(targetAnnotation?.lastValidation ?? null);
  const lastValidationRef = useRef<LocatorValidation | null>(targetAnnotation?.lastValidation ?? null);

  const updatePosition = useCallback(() => {
    if (!primaryAnnotation) {
      return;
    }
    const { el, validation: nextValidation } = resolveAnnotation(primaryAnnotation);

    if (!isSameValidation(lastValidationRef.current, nextValidation)) {
      lastValidationRef.current = nextValidation;
      setValidation(nextValidation);
      if (onValidation) {
        onValidation(primaryAnnotation, nextValidation);
      }
    }

    if (el) {
      const newRect = el.getBoundingClientRect();
      if (!rect || Math.abs(newRect.top - rect.top) > 0.5 || Math.abs(newRect.left - rect.left) > 0.5) {
        setRect(newRect);
      }
    } else if (rect) {
      setRect(null);
    }
  }, [primaryAnnotation, onValidation, rect]);

  useEffect(() => {
    updatePosition();
    const positionTimer = setInterval(updatePosition, 1000);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      clearInterval(positionTimer);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  const targetAnnotationId = targetAnnotation?.id;
  useEffect(() => {
    if (!targetAnnotationId) {
      return;
    }
    setConfirmRecapture(false);
    setIsRecapturing(false);
    if (confirmRecaptureTimer.current != null) {
      window.clearTimeout(confirmRecaptureTimer.current);
      confirmRecaptureTimer.current = null;
    }
    return () => {
      if (confirmRecaptureTimer.current != null) {
        window.clearTimeout(confirmRecaptureTimer.current);
        confirmRecaptureTimer.current = null;
      }
    };
  }, [targetAnnotationId]);

  // broken / ambiguous with no unique element: no floating badge
  if (!targetAnnotation || !rect || rect.width === 0 || rect.height === 0) {
    return null;
  }
  if (rect.top === 0 && rect.left === 0) {
    return null;
  }

  const annotation = targetAnnotation;
  const status = validation?.status ?? "broken";
  const statusMeta = STATUS_COLOR[status] ?? STATUS_COLOR.broken;
  const locators = ensureLocators(annotation);
  const suggestIdx = validation?.suggestPromoteTo ?? null;
  const canPromote = status === "weak" && suggestIdx != null && onPromote;

  const isCluster = badgeItems.length > 1;
  const badgeLabel = isCluster ? `${badgeItems[0].index}+` : `${badgeItems[0]?.index ?? 1}`;

  const badgeBg =
    status === "ok"
      ? isActive
        ? "var(--color-error, #dc2626)"
        : "var(--color-primary, #2563eb)"
      : status === "weak"
        ? "var(--color-warning, #d97706)"
        : status === "ambiguous"
          ? "var(--color-secondary, #7e22ce)"
          : "var(--color-error, #b91c1c)";

  const dotLeft = Math.max(4, Math.min((rect?.left ?? 16) - 12, window.innerWidth - 32));
  const dotTop = Math.max(4, Math.min((rect?.top ?? 16) - 12, window.innerHeight - 32));
  const pinSize = isCluster ? 28 : 24;
  const pinGap = 12;
  const viewportPad = 16;
  const placeAbove = Boolean(rect && rect.bottom + 280 > window.innerHeight);
  const spaceAbove = Math.max(0, dotTop - pinGap - viewportPad);
  const spaceBelow = Math.max(0, window.innerHeight - (dotTop + pinSize + pinGap) - viewportPad);
  const maxCardHeight = Math.max(160, Math.min(480, placeAbove ? spaceAbove : spaceBelow));
  const cardMaxWidth = Math.min(440, window.innerWidth - viewportPad * 2);
  const cardLeft = Math.max(viewportPad, Math.min(dotLeft, window.innerWidth - viewportPad - cardMaxWidth));

  const handleRecaptureClick = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (!onRecapture || isRecapturing) {
      return;
    }
    if (!confirmRecapture) {
      setConfirmRecapture(true);
      if (confirmRecaptureTimer.current != null) {
        window.clearTimeout(confirmRecaptureTimer.current);
      }
      confirmRecaptureTimer.current = window.setTimeout(() => {
        setConfirmRecapture(false);
        confirmRecaptureTimer.current = null;
      }, 3000);
      return;
    }
    if (confirmRecaptureTimer.current != null) {
      window.clearTimeout(confirmRecaptureTimer.current);
      confirmRecaptureTimer.current = null;
    }
    setConfirmRecapture(false);
    setIsRecapturing(true);
    try {
      await onRecapture(annotation);
    } finally {
      setIsRecapturing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: `${dotTop}px`,
        left: `${dotLeft}px`,
        zIndex: 2147483640,
        pointerEvents: "auto",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            onToggle();
          }
        }}
        title={`locator: ${statusMeta.label}${isCluster ? ` (${badgeItems.length} policies)` : ""}`}
        style={{
          width: isCluster ? "28px" : "24px",
          height: isCluster ? "28px" : "24px",
          borderRadius: "50%",
          backgroundColor: badgeBg,
          color: "var(--color-primary-content, #ffffff)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: isCluster ? "10px" : "11px",
          fontWeight: "900",
          cursor: "pointer",
          boxShadow: isCluster
            ? "0 0 16px var(--color-primary, rgba(96, 165, 250, 0.7)), 3px 3px 0 var(--color-secondary, rgba(236, 72, 153, 0.5))"
            : isActive
              ? "0 0 16px var(--color-error, rgba(239, 68, 68, 0.6))"
              : "0 4px 14px var(--color-primary, rgba(59, 130, 246, 0.5))",
          border: `2px solid ${statusMeta.border}`,
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: isActive ? "scale(1.15)" : "scale(1)",
        }}
      >
        {badgeLabel}
      </div>
      {isActive && (
        <div
          style={{
            position: "fixed",
            top: placeAbove ? "auto" : `${dotTop + pinSize + pinGap}px`,
            bottom: placeAbove ? `${Math.max(viewportPad, window.innerHeight - dotTop + pinGap)}px` : "auto",
            left: `${cardLeft}px`,
            boxSizing: "border-box",
            minWidth: "280px",
            width: "max-content",
            maxWidth: `${cardMaxWidth}px`,
            maxHeight: `${maxCardHeight}px`,
            minHeight: 0,
            overflow: "hidden",
            background: "var(--wt-bg-panel)",
            color: "var(--wt-text-main)",
            padding: "14px 16px 12px",
            borderRadius: "16px",
            boxShadow: "var(--wt-shadow)",
            border: "1px solid var(--wt-border-primary)",
            zIndex: 2147483645,
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {isCluster && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  backgroundColor: "var(--wt-bg-subtle)",
                  padding: "4px",
                  borderRadius: "10px",
                  border: "1px solid var(--wt-border)",
                  overflowX: "auto",
                }}
              >
                {badgeItems.map((item, idx) => {
                  const isTabActive = activeSubIndex === idx;
                  return (
                    <button
                      key={item.annotation.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveSubIndex(idx);
                      }}
                      style={{
                        background: isTabActive
                          ? "linear-gradient(135deg, #ec4899 0%, var(--color-primary, #3b82f6) 100%)"
                          : "var(--wt-bg-subtle)",
                        border: isTabActive ? "1px solid rgba(255, 255, 255, 0.3)" : "none",
                        borderRadius: "7px",
                        color: isTabActive ? "white" : "var(--wt-text-muted)",
                        fontSize: "10px",
                        fontWeight: "800",
                        padding: "4px 9px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>#{item.index}</span>
                      <span
                        style={{ maxWidth: "85px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {item.annotation.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                <Pin style={{ width: "14px", height: "14px", color: "var(--color-primary, #60a5fa)", flexShrink: 0 }} />
                <h4
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    fontWeight: "800",
                    color: "var(--color-primary, #60a5fa)",
                    letterSpacing: "-0.01em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {annotation.role}
                </h4>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    padding: "2px 6px",
                    borderRadius: "999px",
                    background: `${statusMeta.bg}33`,
                    color: statusMeta.border,
                    border: `1px solid ${statusMeta.border}55`,
                  }}
                >
                  {statusMeta.label}
                </span>
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(annotation)}
                    style={{
                      background: "var(--wt-bg-subtle)",
                      border: "1px solid var(--wt-border)",
                      borderRadius: "6px",
                      color: "#f472b6",
                      cursor: "pointer",
                      padding: "3px 7px",
                      fontSize: "11px",
                      fontWeight: "600",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title={t.edit}
                  >
                    <Edit3 style={{ width: "11px", height: "11px" }} />
                    <span>{t.edit}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
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
                    borderRadius: "4px",
                  }}
                  title={t.close}
                >
                  <X style={{ width: "15px", height: "15px" }} />
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <MarkdownRenderer
              content={annotation.description}
              style={{ fontSize: "12px", color: "var(--wt-text-main)" }}
              codeStyle={{
                backgroundColor: "var(--wt-bg-subtle)",
                color: "var(--color-primary, #a5b4fc)",
                border: "1px solid var(--wt-border)",
              }}
            />

            {locators.length > 1 && (
              <div style={{ fontSize: "9.5px", color: "var(--wt-text-muted)", fontFamily: "monospace" }}>
                primary: {locators[0]?.strategy ?? "—"}
                {validation?.resolvedBy != null && validation.resolvedBy > 0
                  ? ` · resolved via #${validation.resolvedBy} (${locators[validation.resolvedBy]?.strategy})`
                  : ""}
              </div>
            )}

            {canPromote && suggestIdx != null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPromote?.(annotation, suggestIdx);
                }}
                style={{
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  border: "none",
                  borderRadius: "8px",
                  color: "white",
                  cursor: "pointer",
                  padding: "8px 10px",
                  fontSize: "11px",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <ArrowUpCircle style={{ width: "14px", height: "14px" }} />
                {t.promotePrimary(suggestIdx, locators[suggestIdx]?.strategy)}
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "4px",
              paddingTop: "8px",
              paddingBottom: "2px",
              borderTop: "1px solid var(--wt-border)",
              flexShrink: 0,
            }}
          >
            {onCopyDescription && (
              <button
                type="button"
                onClick={() => onCopyDescription(annotation)}
                style={{
                  background: "var(--wt-bg-subtle)",
                  border: "1px solid var(--wt-border)",
                  borderRadius: "6px",
                  color: "var(--wt-text-main)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                }}
                title={t.copyDescription}
              >
                <Copy style={{ width: "11px", height: "11px", color: "var(--color-primary, #60a5fa)" }} />
                <span>{t.copyDescription}</span>
              </button>
            )}

            {onCopySelector && (
              <button
                type="button"
                onClick={() => onCopySelector(annotation)}
                style={{
                  background: "var(--wt-bg-subtle)",
                  border: "1px solid var(--wt-border)",
                  borderRadius: "6px",
                  color: "var(--wt-text-main)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                }}
                title={t.copySelector}
              >
                <Target style={{ width: "11px", height: "11px", color: "var(--color-success, #34d399)" }} />
                <span>Selector</span>
              </button>
            )}

            {onRecapture && (
              <button
                type="button"
                onClick={(e) => void handleRecaptureClick(e)}
                disabled={isRecapturing}
                style={{
                  background: confirmRecapture ? "rgba(251, 191, 36, 0.18)" : "var(--wt-bg-subtle)",
                  border: confirmRecapture ? "1px solid rgba(251, 191, 36, 0.45)" : "1px solid var(--wt-border)",
                  borderRadius: "6px",
                  color: confirmRecapture ? "var(--color-warning, #fcd34d)" : "var(--wt-text-main)",
                  cursor: isRecapturing ? "default" : "pointer",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                  opacity: isRecapturing ? 0.6 : 1,
                }}
                title={t.recaptureTitle}
              >
                <Camera style={{ width: "11px", height: "11px", color: confirmRecapture ? "#fcd34d" : "#a78bfa" }} />
                <span>{isRecapturing ? t.capturing : confirmRecapture ? t.recaptureConfirm : t.recapture}</span>
              </button>
            )}

            {onCopySummary && (
              <button
                type="button"
                onClick={() => onCopySummary(annotation)}
                style={{
                  background: "var(--wt-bg-subtle)",
                  border: "1px solid var(--wt-border)",
                  borderRadius: "6px",
                  color: "var(--wt-text-main)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                }}
                title={t.copySummary}
              >
                <FileText style={{ width: "11px", height: "11px", color: "var(--color-warning, #fbbf24)" }} />
                <span>{t.copySummary}</span>
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(annotation.id)}
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  borderRadius: "6px",
                  color: "var(--color-error, #f87171)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: "10px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  marginLeft: "auto",
                  whiteSpace: "nowrap",
                }}
                title={t.delete}
              >
                <Trash2 style={{ width: "11px", height: "11px" }} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
