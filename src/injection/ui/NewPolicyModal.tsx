import { FolderTree, Globe, PlusCircle, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildUnifiedGuideSuggestions, type UnifiedDomainInfo } from "@/shared/lib/guideFeatureLinks";
import { GuideMarkdownEditor, type GuideMarkdownEditorHandle } from "@/shared/ui/markdown-textarea/GuideMarkdownEditor";
import { fetchLoggingDomainsApi } from "../api/gateway";
import type { InjectionAppState } from "../hooks/useInjectionAppState";

type State = Pick<
  InjectionAppState,
  | "editingElement"
  | "setEditingElement"
  | "role"
  | "setRole"
  | "description"
  | "setDescription"
  | "hostPattern"
  | "setHostPattern"
  | "pathPattern"
  | "setPathPattern"
  | "suggestedHostPatterns"
  | "suggestedPathPatterns"
  | "isSaving"
  | "saveAnnotation"
>;

export function NewPolicyModal({ s }: { s: State }) {
  const [extraDomains, setExtraDomains] = useState<UnifiedDomainInfo[]>([]);
  const hostPatternInputRef = useRef<HTMLInputElement>(null);
  const pathPatternInputRef = useRef<HTMLInputElement>(null);
  const descEditorRef = useRef<GuideMarkdownEditorHandle>(null);

  useEffect(() => {
    fetchLoggingDomainsApi().then((domains) => {
      if (domains && domains.length > 0) {
        setExtraDomains(domains.map((h) => ({ host: h })));
      }
    });
  }, []);

  const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
  const customItems = useMemo(
    () => buildUnifiedGuideSuggestions({ currentHost, domains: extraDomains }),
    [currentHost, extraDomains],
  );

  const handleSave = () => {
    const liveHost = hostPatternInputRef.current?.value ?? s.hostPattern;
    const livePath = pathPatternInputRef.current?.value ?? s.pathPattern;
    const liveDesc = descEditorRef.current?.getValue() ?? s.description;
    s.setHostPattern(liveHost);
    s.setPathPattern(livePath);
    s.setDescription(liveDesc);
    void s.saveAnnotation({ hostPattern: liveHost, pathPattern: livePath, description: liveDesc });
  };

  const editingElement = s.editingElement;
  if (!editingElement) {
    return null;
  }
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: "var(--wt-bg-panel)",
          width: "640px",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "92vh",
          overflow: "hidden",
          padding: "20px 24px",
          borderRadius: "20px",
          boxShadow: "var(--wt-shadow)",
          border: "1px solid var(--wt-border)",
          color: "var(--wt-text-main)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <PlusCircle style={{ width: "16px", height: "16px", color: "#ec4899" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "var(--wt-text-main)" }}>
              새 가이드 등록
            </h3>
          </div>
          <button
            type="button"
            onClick={() => s.setEditingElement(null)}
            style={{
              background: "none",
              border: "none",
              color: "var(--wt-text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
            }}
          >
            <X style={{ width: "18px", height: "18px" }} />
          </button>
        </div>

        <div
          style={{
            backgroundColor: "var(--wt-bg-card)",
            border: "1px solid var(--wt-border)",
            padding: "10px 12px",
            borderRadius: "10px",
            fontSize: "10.5px",
            color: "var(--wt-text-muted)",
            lineHeight: "1.4",
          }}
        >
          <span style={{ fontWeight: "700", color: "var(--wt-text-main)" }}>Selector: </span>
          <code style={{ color: "var(--color-primary, #60a5fa)", wordBreak: "break-all", fontFamily: "monospace" }}>
            {editingElement.selector}
          </code>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label htmlFor="wt-role-input" style={{ fontSize: "10px", fontWeight: "500", color: "var(--wt-text-muted)" }}>
            가이드명 (Role / Title)
          </label>
          <input
            id="wt-role-input"
            value={s.role}
            onChange={(e) => s.setRole(e.target.value)}
            placeholder="예: 로그인 버튼 정책"
            style={{
              backgroundColor: "var(--wt-bg-card)",
              border: "1px solid var(--wt-border)",
              borderRadius: "10px",
              padding: "10px 12px",
              color: "var(--wt-text-main)",
              fontSize: "13px",
              fontWeight: "600",
              outline: "none",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            flex: "1 1 20rem",
            minHeight: "260px",
            overflow: "hidden",
          }}
        >
          <label
            htmlFor="wt-desc-input"
            style={{
              fontSize: "10px",
              fontWeight: "500",
              color: "var(--wt-text-muted)",
              flexShrink: 0,
            }}
          >
            설명 (Description - 마크다운 지원)
          </label>
          <GuideMarkdownEditor
            ref={descEditorRef}
            id="wt-desc-input"
            value={s.description}
            onChange={s.setDescription}
            placeholder="상세 규칙, 코드 참조(`path`), - 목록...  [[ 로 기능/도구 검색"
            lang="ko"
            variant="overlay"
            customItems={customItems}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", flexShrink: 0 }}>
          {/* Host Pattern */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              htmlFor="wt-host-pattern"
              style={{
                fontSize: "10px",
                fontWeight: "800",
                color: "var(--wt-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Globe style={{ width: "10px", height: "10px", color: "var(--color-primary, #60a5fa)" }} /> Host Pattern
            </label>
            <input
              id="wt-host-pattern"
              ref={hostPatternInputRef}
              value={s.hostPattern}
              onChange={(e) => s.setHostPattern(e.target.value)}
              onCompositionEnd={(e) => s.setHostPattern(e.currentTarget.value)}
              placeholder="예: *.example.*, !api"
              style={{
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                borderRadius: "8px",
                padding: "8px 10px",
                color: "var(--color-primary, #93c5fd)",
                fontSize: "11px",
                fontFamily: "monospace",
                outline: "none",
              }}
            />

            {/* Host Pattern Suggestions */}
            {s.suggestedHostPatterns.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" }}>
                {s.suggestedHostPatterns.map((pat) => (
                  <button
                    key={pat}
                    type="button"
                    onClick={() => s.setHostPattern(pat)}
                    style={{
                      background: s.hostPattern === pat ? "rgba(59, 130, 246, 0.25)" : "var(--wt-bg-subtle)",
                      border:
                        s.hostPattern === pat
                          ? "1px solid var(--color-primary, #3b82f6)"
                          : "1px solid var(--wt-border)",
                      borderRadius: "4px",
                      color: s.hostPattern === pat ? "var(--color-primary, #93c5fd)" : "var(--wt-text-muted)",
                      fontSize: "9px",
                      fontFamily: "monospace",
                      padding: "2px 6px",
                      cursor: "pointer",
                    }}
                    title="패턴 선택"
                  >
                    {pat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Path Pattern */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              htmlFor="wt-path-pattern"
              style={{
                fontSize: "10px",
                fontWeight: "800",
                color: "var(--wt-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <FolderTree style={{ width: "10px", height: "10px", color: "var(--color-secondary, #f472b6)" }} /> Path
              Pattern
            </label>
            <input
              id="wt-path-pattern"
              ref={pathPatternInputRef}
              value={s.pathPattern}
              onChange={(e) => s.setPathPattern(e.target.value)}
              onCompositionEnd={(e) => s.setPathPattern(e.currentTarget.value)}
              placeholder="예: /products/*"
              style={{
                backgroundColor: "var(--wt-bg-card)",
                border: "1px solid var(--wt-border)",
                borderRadius: "8px",
                padding: "8px 10px",
                color: "var(--color-secondary, #f472b6)",
                fontSize: "11px",
                fontFamily: "monospace",
                outline: "none",
              }}
            />

            {/* Path Pattern Suggestions */}
            {s.suggestedPathPatterns.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" }}>
                {s.suggestedPathPatterns.map((pat) => (
                  <button
                    key={pat}
                    type="button"
                    onClick={() => s.setPathPattern(pat)}
                    style={{
                      background: s.pathPattern === pat ? "rgba(236, 72, 153, 0.25)" : "var(--wt-bg-subtle)",
                      border:
                        s.pathPattern === pat
                          ? "1px solid var(--color-secondary, #ec4899)"
                          : "1px solid var(--wt-border)",
                      borderRadius: "4px",
                      color: s.pathPattern === pat ? "var(--color-secondary, #f472b6)" : "var(--wt-text-muted)",
                      fontSize: "9px",
                      fontFamily: "monospace",
                      padding: "2px 6px",
                      cursor: "pointer",
                    }}
                    title="패턴 선택"
                  >
                    {pat}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "6px",
            flexShrink: 0,
            position: "relative",
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => s.setEditingElement(null)}
            style={{
              backgroundColor: "var(--wt-bg-subtle)",
              border: "1px solid var(--wt-border)",
              borderRadius: "10px",
              padding: "8px 16px",
              color: "var(--wt-text-main)",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!s.role || s.isSaving}
            style={{
              backgroundColor: "var(--color-primary, #3b82f6)",
              border: "none",
              borderRadius: "10px",
              padding: "8px 18px",
              color: "var(--color-primary-content, #ffffff)",
              fontSize: "12px",
              fontWeight: "800",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              opacity: !s.role || s.isSaving ? 0.5 : 1,
            }}
          >
            <Save style={{ width: "14px", height: "14px" }} />
            {s.isSaving ? "저장 중..." : "가이드 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
