import { Edit3, FolderTree, Globe, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "@/entities/inspector";
import { buildUnifiedGuideSuggestions, type UnifiedDomainInfo } from "@/shared/lib/guideFeatureLinks";
import { GuideMarkdownEditor, type GuideMarkdownEditorHandle } from "@/shared/ui/markdown-textarea/GuideMarkdownEditor";
import { fetchLoggingDomainsApi, saveAnnotationApi } from "../api/gateway";

interface EditPolicyModalProps {
  annotation: Annotation;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string) => void;
}

export function EditPolicyModal({ annotation, onClose, onSaved, showToast }: EditPolicyModalProps) {
  const [role, setRole] = useState(annotation.role || "");
  const [description, setDescription] = useState(annotation.description || "");
  const [hostPattern, setHostPattern] = useState(annotation.hostPattern || "");
  const [pathPattern, setPathPattern] = useState(annotation.pathPattern || "");
  const [extraDomains, setExtraDomains] = useState<UnifiedDomainInfo[]>([]);
  const hostPatternRef = useRef(hostPattern);
  const pathPatternRef = useRef(pathPattern);
  const hostPatternInputRef = useRef<HTMLInputElement>(null);
  const pathPatternInputRef = useRef<HTMLInputElement>(null);
  const descEditorRef = useRef<GuideMarkdownEditorHandle>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchLoggingDomainsApi().then((domains) => {
      if (domains && domains.length > 0) {
        setExtraDomains(domains.map((h) => ({ host: h })));
      }
    });
  }, []);

  const currentHost = annotation.domain || (typeof window !== "undefined" ? window.location.hostname : "");
  const customItems = useMemo(
    () => buildUnifiedGuideSuggestions({ currentHost, domains: extraDomains }),
    [currentHost, extraDomains],
  );

  const commitHostPattern = (value: string) => {
    hostPatternRef.current = value;
    setHostPattern(value);
  };
  const commitPathPattern = (value: string) => {
    pathPatternRef.current = value;
    setPathPattern(value);
  };

  const handleSave = async () => {
    if (!role.trim()) {
      return;
    }
    setIsSaving(true);

    const liveHost = hostPatternInputRef.current?.value ?? hostPatternRef.current;
    const livePath = pathPatternInputRef.current?.value ?? pathPatternRef.current;
    const liveDesc = descEditorRef.current?.getValue() ?? description;
    hostPatternRef.current = liveHost;
    pathPatternRef.current = livePath;

    const updated: Annotation = {
      ...annotation,
      role: role.trim(),
      description: liveDesc.trim(),
      hostPattern: liveHost.trim(),
      pathPattern: livePath.trim(),
    };

    try {
      const res = await saveAnnotationApi(updated as Record<string, unknown>);
      if (res.ok) {
        onSaved();
        showToast("가이드가 수정되었습니다.");
        window.parent.postMessage({ type: "WT_POLICY_SAVED" }, "*");
        onClose();
      } else {
        showToast("저장에 실패했습니다.");
      }
    } catch (_e) {
      showToast("저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

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
            <Edit3 style={{ width: "16px", height: "16px", color: "#ec4899" }} />
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "var(--wt-text-main)" }}>
              가이드 수정
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
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

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            htmlFor="edit-role-input"
            style={{ fontSize: "10px", fontWeight: "500", color: "var(--wt-text-muted)" }}
          >
            가이드명 (Role / Title)
          </label>
          <input
            id="edit-role-input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
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
            htmlFor="edit-desc-input"
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
            id="edit-desc-input"
            value={description}
            onChange={setDescription}
            placeholder="상세 규칙, 코드 참조(`path`), - 목록...  [[ 로 기능/도구 검색"
            lang="ko"
            variant="overlay"
            customItems={customItems}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              htmlFor="edit-host-pattern"
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
              id="edit-host-pattern"
              ref={hostPatternInputRef}
              value={hostPattern}
              onChange={(e) => commitHostPattern(e.target.value)}
              onCompositionEnd={(e) => commitHostPattern(e.currentTarget.value)}
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
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              htmlFor="edit-path-pattern"
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
              id="edit-path-pattern"
              ref={pathPatternInputRef}
              value={pathPattern}
              onChange={(e) => commitPathPattern(e.target.value)}
              onCompositionEnd={(e) => commitPathPattern(e.currentTarget.value)}
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
            onClick={onClose}
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
            disabled={!role.trim() || isSaving}
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
              opacity: !role.trim() || isSaving ? 0.5 : 1,
            }}
          >
            <Save style={{ width: "14px", height: "14px" }} />
            {isSaving ? "저장 중..." : "저장 완료"}
          </button>
        </div>
      </div>
    </div>
  );
}
