import { useCallback, useEffect, useMemo, useState } from "react";
import type { Annotation, LocatorValidation } from "@/entities/inspector";
import { annotationMatchesPage } from "@/shared/lib/guideMatch";
import { deleteAnnotationApi, fetchAnnotationsApi, saveAnnotationApi, subscribeAnnotations } from "../api/gateway";
import { useInjectionCopy } from "../i18n";
import { captureElementThumbnail, capturePageMeta } from "../lib/capture";
import { denormalizedSelector, ensureLocators, promoteLocator, resolveAnnotation } from "../lib/locator";

export function useAnnotations() {
  const t = useInjectionCopy();
  const [allAnnotations, setAnnotations] = useState<Annotation[]>([]);
  const [showPolicyBadges, setShowPolicyBadges] = useState(true);
  const [activeBadgeId, setActiveBadgeId] = useState<string | null>(null);

  const fetchAnnotations = useCallback(() => {
    fetchAnnotationsApi()
      .then((data) => setAnnotations(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "WT_POLICY_SAVED") {
        fetchAnnotations();
      }
    };
    window.addEventListener("message", handleMessage);
    const unsubscribe = subscribeAnnotations(setAnnotations);
    return () => {
      window.removeEventListener("message", handleMessage);
      unsubscribe();
    };
  }, [fetchAnnotations]);

  const currentPagePolicies = useMemo(() => {
    const currentHost = window.location.host;
    const currentPath = window.location.pathname;
    return allAnnotations.filter((ann) => annotationMatchesPage(ann, currentHost, currentPath));
  }, [allAnnotations]);

  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const copyToClipboard = useCallback((text: string, toastMsg: string) => {
    try {
      navigator.clipboard.writeText(text);
      setToastMessage(toastMsg);
    } catch (_e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setToastMessage(toastMsg);
    }
  }, []);

  const copyDescription = useCallback(
    (ann: Annotation, e?: React.MouseEvent) => {
      e?.stopPropagation();
      copyToClipboard(ann.description || "", t.copiedDescription(ann.role));
    },
    [copyToClipboard, t],
  );

  const copySelector = useCallback(
    (ann: Annotation, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const locs = ensureLocators(ann);
      const primary = locs[0];
      const line =
        primary?.strategy === "role"
          ? `role=${primary.role} name=${primary.name}`
          : `${primary?.strategy ?? "css"}=${primary?.value ?? ann.selector}`;
      copyToClipboard(line || ann.selector || "", t.copiedLocator(ann.role));
    },
    [copyToClipboard, t],
  );

  const copySummary = useCallback(
    (ann: Annotation, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const locs = ensureLocators(ann)
        .map((l, i) => {
          if (l.strategy === "role") {
            return `${i}: role ${l.role}/${l.name}`;
          }
          return `${i}: ${l.strategy}=${l.value ?? ""}`;
        })
        .join(", ");
      const summary = `### [${ann.role}]\n${ann.description || "-"}\n\n- Locators: \`${locs}\`\n- Selector: \`${ann.selector}\`\n- Host Pattern: \`${ann.hostPattern || ann.domain || "*"}\`\n- Path Pattern: \`${ann.pathPattern || "*"}\`\n- Validation: \`${ann.lastValidation?.status ?? "unknown"}\`\n- URL: ${ann.url || "-"}`;
      copyToClipboard(summary, t.copiedSummary(ann.role));
    },
    [copyToClipboard, t],
  );

  const deleteAnnotation = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    const res = await deleteAnnotationApi(id);
    if (res.ok) {
      fetchAnnotations();
      setToastMessage(t.guideDeleted);
    }
  };

  const persistValidation = useCallback((ann: Annotation, validation: LocatorValidation) => {
    const updated: Annotation = { ...ann, lastValidation: validation };
    setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? updated : a)));
  }, []);

  const recaptureAnnotation = useCallback(
    async (ann: Annotation) => {
      const { el } = resolveAnnotation(ann);
      if (!el) {
        setToastMessage(t.elementMissing(ann.role));
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        setToastMessage(t.elementTooSmall(ann.role));
        return;
      }
      const thumbnail = await captureElementThumbnail(el);
      const pageMeta = capturePageMeta();
      const updated: Annotation = {
        ...ann,
        thumbnail: thumbnail || ann.thumbnail,
        domain: pageMeta.domain,
        url: pageMeta.url,
        content: (el.innerText || "").substring(0, 100),
        timestamp: Date.now(),
      };
      const res = await saveAnnotationApi(updated as unknown as Record<string, unknown>);
      if (res.ok) {
        setToastMessage(thumbnail ? t.recaptureOk(ann.role) : t.recapturePartial(ann.role));
        fetchAnnotations();
        window.parent.postMessage({ type: "WT_POLICY_SAVED" }, "*");
      } else {
        setToastMessage(t.recaptureFailed);
      }
    },
    [fetchAnnotations, t],
  );

  const promoteAnnotation = useCallback(
    async (ann: Annotation, promoteIndex: number) => {
      const locators = promoteLocator(ensureLocators(ann), promoteIndex);
      const updated: Annotation = {
        ...ann,
        locators,
        selector: denormalizedSelector(locators) || ann.selector,
        lastValidation: null,
      };
      setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? updated : a)));
      const res = await saveAnnotationApi(updated as unknown as Record<string, unknown>);
      if (res.ok) {
        setToastMessage(t.promoted(ann.role));
        fetchAnnotations();
        window.parent.postMessage({ type: "WT_POLICY_SAVED" }, "*");
      } else {
        setToastMessage(t.promoteFailed);
        fetchAnnotations();
      }
    },
    [fetchAnnotations, t],
  );

  return {
    allAnnotations,
    showPolicyBadges,
    setShowPolicyBadges,
    activeBadgeId,
    setActiveBadgeId,
    currentPagePolicies,
    editingAnnotation,
    setEditingAnnotation,
    toastMessage,
    setToastMessage,
    showToast,
    copyDescription,
    copySelector,
    copySummary,
    fetchAnnotations,
    deleteAnnotation,
    persistValidation,
    recaptureAnnotation,
    promoteAnnotation,
  };
}
