import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import html2canvas from "html2canvas";
import { useAtom, useAtomValue } from "jotai";
import { jsPDF } from "jspdf";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  FolderTree,
  Globe,
  Info,
  LayoutGrid,
  Maximize2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { languageAtom } from "@/entities/app";
import type { Annotation } from "@/entities/inspector";
import { commands, type Domain, unwrap } from "@/shared/api";
import { GUIDE_FEATURE_PANEL, isGuideFeatureAlias } from "@/shared/lib/guideFeatureLinks";
import {
  annotationMatchesHost,
  type GuideHostCoverage,
  guideMatchesHostFilter,
  isAllGuideHostFilter,
  resolveGuideHostCoverage,
  resolveGuideHostFilterSeed,
} from "@/shared/lib/guideMatch";
import { MarkdownRenderer } from "@/shared/lib/MarkdownRenderer";
import { useIsDetachedWindow } from "@/shared/lib/tauri/useEmbedMode";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import type { GuideMarkdownEditorHandle } from "@/shared/ui/markdown-textarea/GuideMarkdownEditor";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { SegmentedTabs } from "@/shared/ui/tabs";
import { reportError, toastError, toastInfo, toastSuccess } from "@/shared/ui/toast";
import { useDomainHubData } from "../../hooks/useDomainHubData";
import { usePanelNavigation } from "../../hooks/usePanelNavigation";
import { canOpenPanel } from "../../lib/panelGates";
import { hubPoliciesDomainSeedAtom } from "../../store";
import type { HubSurfaceId, PanelId } from "../../types";
import { GuideDescriptionField } from "./GuideDescriptionField";
import { policiesEn } from "./policies-en";
import { policiesKo } from "./policies-ko";

type ViewMode = "manage" | "report";
type GuideEditForm = {
  role: string;
  description: string;
  domain: string;
  hostPattern: string;
  pathPattern: string;
  url: string;
};

const FILTER_UNMATCHED = "UNMATCHED";
const HOST_PICKER_LIMIT = 40;
const COVERAGE_LIST_LIMIT = 80;
const COVERAGE_PREVIEW_DEBOUNCE_MS = 150;

const EMPTY_EDIT_FORM: GuideEditForm = {
  role: "",
  description: "",
  domain: "",
  hostPattern: "",
  pathPattern: "",
  url: "",
};

function readInputValue(input: HTMLInputElement | null, fallback: string): string {
  return input?.value ?? fallback;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors whitespace-nowrap shrink-0",
        active ? "bg-primary text-primary-content" : "bg-base-200 text-base-content/60 hover:bg-base-300",
      )}
    >
      {children}
    </button>
  );
}

function CoverageBanner({ coverage, t }: { coverage: GuideHostCoverage | undefined; t: typeof policiesKo }) {
  if (coverage?.status !== "none") {
    return null;
  }
  return (
    <div className="flex items-start gap-1.5 rounded-lg bg-error/10 text-error px-2 py-1.5">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <p className="text-[10px] font-bold leading-snug m-0">{t.coverageNone}</p>
    </div>
  );
}

function HostCoveragePanel({ coverage, t }: { coverage: GuideHostCoverage | undefined; t: typeof policiesKo }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"in" | "out">(coverage && coverage.matchedHosts.length === 0 ? "out" : "in");
  const [query, setQuery] = useState("");

  if (!coverage || (coverage.matchedHosts.length === 0 && coverage.unmatchedHosts.length === 0)) {
    return null;
  }

  const source = tab === "in" ? coverage.matchedHosts : coverage.unmatchedHosts;
  const needle = query.trim().toLowerCase();
  const filtered = needle ? source.filter((host) => host.includes(needle)) : source;
  const visible = filtered.slice(0, COVERAGE_LIST_LIMIT);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200/40 hover:bg-base-200 px-2 py-1.5 text-left"
      >
        <span className="text-[10px] font-bold text-base-content/70 truncate">
          {t.coverageIncluded} {coverage.matchedHosts.length}
          <span className="text-base-content/30"> · </span>
          {t.coverageExcluded} {coverage.unmatchedHosts.length}
        </span>
        <ChevronDown
          className={clsx("w-3.5 h-3.5 text-base-content/40 shrink-0 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg border border-base-300 bg-base-100 p-2">
          <SegmentedTabs<"in" | "out">
            value={tab}
            onChange={setTab}
            size="xs"
            fullWidth
            className="mb-1.5"
            items={[
              { id: "in", label: t.coverageIncluded, badge: coverage.matchedHosts.length },
              { id: "out", label: t.coverageExcluded, badge: coverage.unmatchedHosts.length },
            ]}
          />
          <div className="relative mb-1.5">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-base-content/35" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.coverageSearchHosts}
              className="pl-7 h-7 text-[10px] rounded-md"
            />
          </div>
          <div className="max-h-36 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <p className="text-[10px] text-base-content/40 px-1 py-2 m-0">{t.coverageEmptyList}</p>
            ) : (
              <>
                {visible.map((host) => (
                  <p key={host} className="text-[10px] font-mono truncate px-1 py-0.5 m-0 text-base-content/80">
                    {host}
                  </p>
                ))}
                {filtered.length > COVERAGE_LIST_LIMIT && (
                  <p className="text-[10px] text-base-content/40 px-1 py-1 m-0">
                    +{filtered.length - COVERAGE_LIST_LIMIT}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HostFilterPicker({
  hosts,
  value,
  onSelect,
  placeholder,
  typeToSearch,
}: {
  hosts: string[];
  value: string;
  onSelect: (host: string) => void;
  placeholder: string;
  typeToSearch: string;
}) {
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const hostSelected = !isAllGuideHostFilter(value) && value !== FILTER_UNMATCHED;
  const needle = query.trim().toLowerCase();
  const requireQuery = !needle && hosts.length > HOST_PICKER_LIMIT;
  const filtered = needle ? hosts.filter((host) => host.includes(needle)) : hosts;
  const visible = requireQuery ? [] : filtered.slice(0, HOST_PICKER_LIMIT);

  return (
    <div className="relative min-w-0 flex-1 max-w-xs">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/40 pointer-events-none" />
      <Input
        value={pickerOpen || !hostSelected ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          setPickerOpen(true);
        }}
        onFocus={() => {
          setPickerOpen(true);
          if (hostSelected) {
            setQuery("");
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setPickerOpen(false), 120);
        }}
        placeholder={placeholder}
        className="pl-8 h-8 text-[11px] rounded-lg shadow-sm"
      />
      {pickerOpen && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg border border-base-300 bg-base-100 shadow-lg max-h-48 overflow-y-auto scrollbar-thin">
          {requireQuery ? (
            <p className="text-[10px] text-base-content/40 px-3 py-2 m-0">{typeToSearch}</p>
          ) : visible.length === 0 ? (
            <p className="text-[10px] text-base-content/40 px-3 py-2 m-0">—</p>
          ) : (
            <>
              {visible.map((host) => (
                <button
                  key={host}
                  type="button"
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-[11px] font-mono truncate hover:bg-base-200",
                    host === value && "bg-primary/10 text-primary font-bold",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(host);
                    setQuery("");
                    setPickerOpen(false);
                  }}
                >
                  {host}
                </button>
              ))}
              {filtered.length > HOST_PICKER_LIMIT && (
                <p className="text-[10px] text-base-content/40 px-3 py-1.5 m-0 border-t border-base-200">
                  +{filtered.length - HOST_PICKER_LIMIT}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function resolveGuideLinkDomain(
  ann: Annotation,
  hubDomainId: number | null,
  domains: Domain[],
  getHost: (domain: Domain) => string,
): Domain | null {
  const hubDomain = hubDomainId != null ? (domains.find((d) => d.id === hubDomainId) ?? null) : null;
  if (hubDomain && annotationMatchesHost(ann, getHost(hubDomain))) {
    return hubDomain;
  }
  return domains.find((d) => annotationMatchesHost(ann, getHost(d))) ?? null;
}

export function PoliciesView() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? policiesKo : policiesEn;
  const { domains: registeredDomains, fetchAll, getDomainHost, getFeatureState } = useDomainHubData();
  const nav = usePanelNavigation();
  const isDetached = useIsDetachedWindow();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("manage");
  const [domainSeed, setDomainSeed] = useAtom(hubPoliciesDomainSeedAtom);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Annotation | null>(null);
  const [editForm, setEditForm] = useState<GuideEditForm>(EMPTY_EDIT_FORM);
  const editFormRef = useRef(editForm);
  const hostPatternInputRef = useRef<HTMLInputElement>(null);
  const pathPatternInputRef = useRef<HTMLInputElement>(null);
  const roleInputRef = useRef<HTMLInputElement>(null);
  const domainInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const descEditorRef = useRef<GuideMarkdownEditorHandle>(null);
  const [previewCoverage, setPreviewCoverage] = useState({ hostPattern: "", domain: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const setEditField = useCallback(<K extends keyof GuideEditForm>(key: K, value: GuideEditForm[K]) => {
    const next = { ...editFormRef.current, [key]: value };
    editFormRef.current = next;
    setEditForm(next);
  }, []);

  const liveEditForm = useCallback((): GuideEditForm => {
    const current = editFormRef.current;
    const next = {
      ...current,
      role: readInputValue(roleInputRef.current, current.role),
      description: descEditorRef.current?.getValue() ?? current.description,
      hostPattern: readInputValue(hostPatternInputRef.current, current.hostPattern),
      pathPattern: readInputValue(pathPatternInputRef.current, current.pathPattern),
      domain: readInputValue(domainInputRef.current, current.domain),
      url: readInputValue(urlInputRef.current, current.url),
    };
    editFormRef.current = next;
    return next;
  }, []);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [visibleFields, setVisibleFields] = useState({
    selector: false,
    tag: false,
    url: true,
  });

  const documentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [ready, setReady] = useState(false);

  const fetchAnnotations = useCallback(async () => {
    try {
      const res = unwrap(await commands.getAnnotations());
      if (res.success && Array.isArray(res.data)) {
        setAnnotations(res.data);
        setLoadError(null);
        return;
      }
      const message = res.message?.trim() || t.loadFailed;
      setLoadError(message);
      reportError(message, { title: t.loadFailed });
    } catch (err) {
      setLoadError(t.loadFailed);
      reportError(err, { title: t.loadFailed });
    } finally {
      setReady(true);
    }
  }, [t.loadFailed]);

  useEffect(() => {
    fetchAnnotations();
    void fetchAll();
    const unlisten = listen("annotations-updated", fetchAnnotations);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchAnnotations, fetchAll]);

  const registeredHosts = useMemo(
    () => registeredDomains.map((domain) => ({ host: getDomainHost(domain) })),
    [registeredDomains, getDomainHost],
  );

  const coverageById = useMemo(() => {
    const map = new Map<string, GuideHostCoverage>();
    for (const ann of annotations) {
      map.set(ann.id, resolveGuideHostCoverage(ann, registeredHosts));
    }
    return map;
  }, [annotations, registeredHosts]);

  const unmatchedCount = useMemo(
    () => annotations.filter((ann) => coverageById.get(ann.id)?.status === "none").length,
    [annotations, coverageById],
  );

  const allHostNames = useMemo(
    () => Array.from(new Set(registeredHosts.map((item) => item.host))).sort(),
    [registeredHosts],
  );

  useEffect(() => {
    if (!domainSeed || !ready) {
      return;
    }
    setSelectedDomain(resolveGuideHostFilterSeed(domainSeed, allHostNames));
    setDomainSeed(null);
  }, [allHostNames, domainSeed, ready, setDomainSeed]);

  const filteredAnnotations = useMemo(() => {
    const q = search.toLowerCase();
    return annotations.filter((ann) => {
      const coverage = coverageById.get(ann.id);
      const matchesDomain = guideMatchesHostFilter(ann, selectedDomain, {
        unmatched: selectedDomain === FILTER_UNMATCHED,
        unmatchedStatus: coverage?.status,
      });
      const matchesSearch =
        q === "" ||
        (ann.role ?? "").toLowerCase().includes(q) ||
        (ann.description ?? "").toLowerCase().includes(q) ||
        (ann.selector ?? "").toLowerCase().includes(q) ||
        (ann.hostPattern ?? "").toLowerCase().includes(q);
      return matchesDomain && matchesSearch;
    });
  }, [annotations, selectedDomain, search, coverageById]);

  const emptyListCopy = !ready
    ? t.loading
    : loadError && annotations.length === 0
      ? t.loadFailed
      : annotations.length === 0
        ? t.noPolicies
        : t.noFilterResults;

  const openGuideFeature = useCallback(
    (ann: Annotation, aliasOrPath: string) => {
      // 1. Direct domain link: hg://domain/:id or hg://domain/:id/:panelId
      if (aliasOrPath.startsWith("domain/")) {
        const parts = aliasOrPath.slice("domain/".length).split("/");
        const domainId = parseInt(parts[0], 10);
        if (!Number.isNaN(domainId)) {
          const panelId = (parts.slice(1).join("/") as PanelId) || "overview";
          if (isDetached) {
            toastInfo(t.featureLinkUseHub);
            return;
          }
          nav.openPanelForDomain(domainId, panelId);
          return;
        }
      }

      // 2. Global tools mapping
      const globalToolMap: Record<string, HubSurfaceId> = {
        "api-client": "global/api-client",
        "api-logs": "global/api-logs",
        mocking: "global/mocking",
        "json-schema": "global/json-schema",
        "schema-explorer": "global/schema-explorer",
        pipeline: "global/pipeline",
        crypto: "global/crypto",
        preview: "global/preview",
        "live-capture": "global/live-capture",
        "proxy-graph": "global/proxy-graph",
        monitor: "global/monitor",
        "server-logs": "global/server-logs",
        policies: "global/policies",
      };

      if (aliasOrPath.startsWith("global/")) {
        nav.openGlobalSurface(aliasOrPath as HubSurfaceId);
        return;
      }

      // 3. Check legacy aliases with domain resolution
      if (isGuideFeatureAlias(aliasOrPath)) {
        const domain = resolveGuideLinkDomain(ann, nav.domainId, registeredDomains, getDomainHost);
        if (domain) {
          const rawPanel = GUIDE_FEATURE_PANEL[aliasOrPath];
          const panelId = rawPanel as PanelId;
          if (panelId && canOpenPanel(panelId, getFeatureState(domain.id))) {
            if (isDetached) {
              toastInfo(t.featureLinkUseHub);
              return;
            }
            nav.openPanelForDomain(domain.id, panelId);
            return;
          }
        }
        if (globalToolMap[aliasOrPath]) {
          nav.openGlobalSurface(globalToolMap[aliasOrPath]);
          return;
        }
        toastInfo(t.featureLinkNoDomain);
        return;
      }

      if (globalToolMap[aliasOrPath]) {
        nav.openGlobalSurface(globalToolMap[aliasOrPath]);
        return;
      }
    },
    [getDomainHost, getFeatureState, isDetached, nav, registeredDomains, t],
  );

  const handleDelete = async (id: string) => {
    try {
      const res = unwrap(await commands.deleteAnnotation({ id }));
      if (res.success && res.data) {
        setAnnotations(res.data);
        return;
      }
      reportError(res.message?.trim() || t.deleteFailed, { title: t.deleteFailed });
    } catch (err) {
      reportError(err, { title: t.deleteFailed });
    } finally {
      setDeleteId(null);
    }
  };

  const openEditModal = (ann: Annotation) => {
    const next: GuideEditForm = {
      role: ann.role,
      description: ann.description,
      domain: ann.domain || "",
      hostPattern: ann.hostPattern || "",
      pathPattern: ann.pathPattern || "",
      url: ann.url || "",
    };
    editFormRef.current = next;
    setEditForm(next);
    setPreviewCoverage({ hostPattern: next.hostPattern, domain: next.domain });
    setEditingPolicy(ann);
    setIsEditModalOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingPolicy) {
      toastError(t.saveFailed);
      return;
    }
    const form = liveEditForm();
    setEditForm(form);
    if (!form.role.trim()) {
      toastError(t.saveRoleRequired);
      return;
    }
    setIsSavingEdit(true);
    try {
      const res = unwrap(
        await commands.updateAnnotation({
          id: editingPolicy.id,
          role: form.role,
          description: form.description,
          domain: form.domain,
          url: form.url,
          hostPattern: form.hostPattern,
          pathPattern: form.pathPattern,
        }),
      );
      if (res.success && res.data) {
        setAnnotations(res.data);
        setIsEditModalOpen(false);
        return;
      }
      reportError(res.message?.trim() || t.saveFailed, { title: t.saveFailed });
    } catch (err) {
      reportError(err, { title: t.saveFailed });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleExportPdf = async () => {
    if (filteredAnnotations.length === 0) {
      return;
    }

    const originalView = viewMode;
    if (viewMode !== "report") {
      setViewMode("report");
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!documentRef.current) {
      return;
    }
    setIsExporting(true);

    try {
      const filePath = await save({
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        defaultPath: `${t.pdfFileName}.pdf`,
      });
      if (!filePath) {
        setIsExporting(false);
        if (originalView !== "report") {
          setViewMode(originalView);
        }
        return;
      }

      const element = documentRef.current;
      const canvas = await html2canvas(element, {
        scale: 1.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        scrollY: -window.scrollY,
        scrollX: 0,
        windowWidth: 1200,
        onclone: (clonedDoc) => {
          const styles = clonedDoc.getElementsByTagName("style");
          for (let i = styles.length - 1; i >= 0; i--) {
            styles[i].remove();
          }
          const links = clonedDoc.getElementsByTagName("link");
          for (let i = links.length - 1; i >= 0; i--) {
            if (links[i].rel === "stylesheet") {
              links[i].remove();
            }
          }
          const reportEl = clonedDoc.getElementById("policy-document-view");
          if (reportEl) {
            reportEl.style.width = "1100px";
            reportEl.style.padding = "80px";
            reportEl.style.margin = "0 auto";
          }
        },
      });

      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const pxPerMm = imgWidth / pdfWidth;
      const canvasPageHeight = pdfHeight * pxPerMm;

      let heightLeft = imgHeight;
      let sY = 0;

      while (heightLeft > 0) {
        const h = Math.min(heightLeft, canvasPageHeight);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = imgWidth;
        pageCanvas.height = h;
        const ctx = pageCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(canvas, 0, sY, imgWidth, h, 0, 0, imgWidth, h);
        }
        const pageData = pageCanvas.toDataURL("image/jpeg", 0.9);
        const renderedHeight = h / pxPerMm;
        pdf.addImage(pageData, "JPEG", 0, 0, pdfWidth, renderedHeight, undefined, "FAST");
        heightLeft -= h;
        sY += h;
        if (heightLeft > 0) {
          pdf.addPage();
        }
      }

      const pdfArrayBuffer = pdf.output("arraybuffer");
      await writeFile(filePath, new Uint8Array(pdfArrayBuffer));
      toastSuccess("PDF 리포트가 성공적으로 생성되었습니다.");
    } catch (err) {
      console.error(err);
      toastError(`PDF 생성 중 오류 발생: ${err}`);
    } finally {
      setIsExporting(false);
      if (originalView !== "report") {
        setViewMode(originalView);
      }
    }
  };

  const openExternalUrl = async (url: string | null | undefined) => {
    if (!url) {
      return;
    }
    try {
      await openPath(url);
    } catch {
      try {
        await openUrl(url);
      } catch {
        window.open(url, "_blank");
      }
    }
  };

  const handleExportJson = async () => {
    try {
      const filePath = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: "horizon-gateway-policies.json",
      });
      if (!filePath) {
        return;
      }
      await writeTextFile(filePath, JSON.stringify(annotations, null, 2));
      toastSuccess(t.exportSuccess);
    } catch (err) {
      toastError(`Export failed: ${err}`);
    }
  };

  const handleImportJson = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const content = await readTextFile(selected);
      const imported = JSON.parse(content) as Annotation[];
      const res = unwrap(await commands.importAnnotations({ annotations: imported }));
      if (res.success && res.data) {
        setAnnotations(res.data);
        toastSuccess(`${imported.length}${t.importSuccess}`);
      }
    } catch (err) {
      toastError(`Import failed: ${err}`);
    }
  };

  useEffect(() => {
    if (!isEditModalOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewCoverage({ hostPattern: editForm.hostPattern, domain: editForm.domain });
    }, COVERAGE_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [editForm.domain, editForm.hostPattern, isEditModalOpen]);

  const editCoverage = useMemo(
    () => resolveGuideHostCoverage(previewCoverage, registeredHosts),
    [previewCoverage, registeredHosts],
  );

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-base-100 text-base-content">
      <div className="flex flex-col gap-3 p-4 border-b border-base-300 bg-base-200/50 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary shrink-0" />
              <h1 className="text-sm font-black tracking-tight">{t.title}</h1>
              <span className="text-[10px] font-bold text-base-content/40">
                {filteredAnnotations.length}
                {lang === "ko" ? "개" : ""}
              </span>
            </div>
            <p className="text-[10px] text-base-content/50 font-medium mt-0.5">{t.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs<ViewMode>
              value={viewMode}
              onChange={setViewMode}
              size="xs"
              items={[
                { id: "manage", label: t.viewManage, icon: LayoutGrid },
                { id: "report", label: t.viewPreview, icon: FileText },
              ]}
            />

            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[10px] font-bold" onClick={handleImportJson}>
              <Upload className="w-3.5 h-3.5" />
              {t.importJson}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[10px] font-bold" onClick={handleExportJson}>
              <Download className="w-3.5 h-3.5" />
              {t.exportJson}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-8 gap-1.5 text-[10px] font-black"
              onClick={handleExportPdf}
              disabled={isExporting || filteredAnnotations.length === 0}
            >
              {isExporting ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {t.exportPdf}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative w-48 sm:w-64 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="pl-8 h-8 text-[11px] rounded-lg shadow-sm"
              />
            </div>
            <div className="flex gap-1 items-center min-w-0 flex-1">
              <FilterChip active={isAllGuideHostFilter(selectedDomain)} onClick={() => setSelectedDomain("ALL")}>
                {t.filterAll}
              </FilterChip>
              {unmatchedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedDomain(FILTER_UNMATCHED)}
                  className={clsx(
                    "px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1",
                    selectedDomain === FILTER_UNMATCHED
                      ? "bg-error text-error-content"
                      : "bg-error/10 text-error hover:bg-error/20",
                  )}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {t.filterUnmatched} ({unmatchedCount})
                </button>
              )}
              <HostFilterPicker
                hosts={allHostNames}
                value={selectedDomain}
                onSelect={setSelectedDomain}
                placeholder={t.filterHostPlaceholder}
                typeToSearch={t.filterHostTypeToSearch}
              />
              {selectedDomain !== FILTER_UNMATCHED && !isAllGuideHostFilter(selectedDomain) && (
                <button
                  type="button"
                  onClick={() => setSelectedDomain("ALL")}
                  className="shrink-0 p-1 rounded-md text-base-content/40 hover:text-base-content hover:bg-base-200"
                  title={t.filterHostClear}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {viewMode === "report" && (
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[9px] font-medium text-base-content/50 shrink-0 flex items-center gap-1">
                <Settings2 className="w-3 h-3" />
                {t.displayOptions}
              </span>
              <div className="flex items-center gap-3">
                {(["url", "tag", "selector"] as const).map((field) => (
                  <label key={field} className="flex items-center gap-1.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary rounded-md"
                      checked={visibleFields[field]}
                      onChange={(e) => setVisibleFields((prev) => ({ ...prev, [field]: e.target.checked }))}
                    />
                    <span className="text-[10px] font-medium text-base-content/55 group-hover:text-primary">
                      {field}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 scrollbar-thin">
        {viewMode === "manage" && (
          <div>
            {filteredAnnotations.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-base-content/40 rounded-2xl border-2 border-dashed border-base-300 gap-3">
                {loadError ? (
                  <>
                    <AlertTriangle className="w-10 h-10 text-error opacity-80" />
                    <p className="text-sm font-bold text-error">{loadError}</p>
                    <Button
                      variant="secondary"
                      size="xs"
                      className="mt-1 gap-1.5"
                      onClick={() => {
                        setReady(false);
                        setLoadError(null);
                        fetchAnnotations();
                        void fetchAll();
                      }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t.retry}
                    </Button>
                  </>
                ) : (
                  <>
                    <Info className="w-10 h-10 opacity-40" />
                    <p className="text-sm font-bold">{emptyListCopy}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredAnnotations.map((ann, idx) => (
                  <article
                    key={ann.id}
                    className="group flex flex-col gap-3 p-4 rounded-xl border border-base-300 bg-base-100 hover:border-primary/30 hover:shadow-md transition-all min-h-0"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-md bg-base-200 flex items-center justify-center font-black text-[10px] text-base-content/40 shrink-0">
                          {idx + 1}
                        </span>
                        <h3 className="font-bold text-sm text-base-content truncate" title={ann.role}>
                          {ann.role}
                        </h3>
                      </div>
                      {ann.url && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-7 w-7 p-0 text-primary/40 hover:text-primary hover:bg-primary/10 rounded-full shrink-0"
                          onClick={() => openExternalUrl(ann.url)}
                          title={t.visitSite}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>

                    {ann.thumbnail ? (
                      <div className="relative h-28 bg-base-200 overflow-hidden rounded-lg border border-base-300/50 shrink-0">
                        <img src={ann.thumbnail} alt="" className="w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="rounded-full bg-white/90 text-black border-none h-8 text-[10px]"
                            onClick={() => setZoomImage(ann.thumbnail)}
                          >
                            <Maximize2 className="w-3.5 h-3.5" /> {t.zoom}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="min-h-[4.5rem] max-h-32 overflow-y-auto scrollbar-thin pr-1">
                      <MarkdownRenderer
                        content={ann.description || "-"}
                        className="text-xs text-base-content/80 leading-relaxed"
                        onHgLink={(alias) => openGuideFeature(ann, alias)}
                      />
                    </div>

                    <div className="flex flex-col gap-2 pt-2 border-t border-base-200 mt-auto">
                      <CoverageBanner coverage={coverageById.get(ann.id)} t={t} />
                      <HostCoveragePanel coverage={coverageById.get(ann.id)} t={t} />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-medium text-base-content/50">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          {ann.hostPattern && (
                            <span
                              className="bg-primary/10 text-primary font-mono px-1.5 py-0.5 rounded border border-primary/20 truncate max-w-[180px]"
                              title={ann.hostPattern}
                            >
                              {ann.hostPattern}
                            </span>
                          )}
                          {ann.pathPattern && (
                            <span
                              className="bg-secondary/10 text-secondary font-mono px-1.5 py-0.5 rounded border border-secondary/20 truncate max-w-[120px]"
                              title="Path Pattern"
                            >
                              {ann.pathPattern}
                            </span>
                          )}
                        </div>
                        <span className="whitespace-nowrap">{new Date(ann.timestamp ?? 0).toLocaleDateString()}</span>
                      </div>
                      {ann.domain && (
                        <p className="text-[10px] text-base-content/35 m-0 truncate">
                          {t.capturedOn}: {ann.domain}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1 gap-1.5 text-[11px] font-bold h-8"
                          onClick={() => openEditModal(ann)}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          {t.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-none w-8 h-8 p-0 text-error hover:bg-error/10"
                          onClick={() => setDeleteId(ann.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === "report" && (
          <div className="animate-in fade-in duration-200">
            <div
              ref={documentRef}
              id="policy-document-view"
              style={{
                backgroundColor: "#ffffff",
                color: "#0f172a",
                display: "flex",
                flexDirection: "column",
                gap: "48px",
              }}
              className="p-8 rounded-2xl shadow-sm border border-base-200 mx-auto"
            >
              {filteredAnnotations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24" style={{ color: "#cbd5e1" }}>
                  <Info className="w-12 h-12 mb-3 opacity-40" />
                  <p className="text-base font-bold">{emptyListCopy}</p>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      borderBottom: "2px solid #6366f133",
                      paddingBottom: "24px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                    }}
                  >
                    <div>
                      <h2 style={{ color: "#6366f1", fontSize: "28px", fontWeight: "900", margin: 0 }}>
                        {t.pdfFileName.replace(/_/g, " ")}
                      </h2>
                      <p
                        style={{
                          color: "#94a3b8",
                          fontSize: "13px",
                          fontFamily: "monospace",
                          fontStyle: "italic",
                          margin: "4px 0 0 0",
                        }}
                      >
                        Generated at: {new Date().toLocaleString()}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p
                        style={{
                          color: "#6366f166",
                          fontSize: "11px",
                          fontWeight: "900",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          margin: 0,
                        }}
                      >
                        {selectedDomain}
                      </p>
                      <p style={{ color: "#0f172a", fontSize: "20px", fontWeight: "900", margin: 0 }}>
                        {filteredAnnotations.length} {t.policyCount}
                      </p>
                    </div>
                  </div>

                  {filteredAnnotations.map((ann, idx) => (
                    <div key={ann.id} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                          <span
                            style={{
                              backgroundColor: "#6366f1",
                              color: "#ffffff",
                              width: "28px",
                              height: "28px",
                              borderRadius: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: "900",
                              fontSize: "13px",
                            }}
                          >
                            {idx + 1}
                          </span>
                          <h3
                            style={{
                              color: "#0f172a",
                              fontSize: "20px",
                              fontWeight: "bold",
                              margin: 0,
                              lineHeight: "1.2",
                            }}
                          >
                            {ann.role}
                          </h3>
                        </div>
                        <div
                          style={{
                            color: "#94a3b8",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "12px",
                          }}
                        >
                          <Globe style={{ width: "12px", height: "12px" }} />
                          <span style={{ fontFamily: "monospace" }}>{ann.hostPattern || ann.domain}</span>
                          {ann.domain && ann.hostPattern && ann.hostPattern !== ann.domain && (
                            <>
                              <span>•</span>
                              <span>
                                {t.capturedOn} {ann.domain}
                              </span>
                            </>
                          )}
                          <span>•</span>
                          <span>{new Date(ann.timestamp ?? 0).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(12, 1fr)",
                          gap: "24px",
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ gridColumn: "span 5" }}>
                          <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                            <img src={ann.thumbnail} alt="" style={{ width: "100%", display: "block" }} />
                          </div>
                        </div>

                        <div style={{ gridColumn: "span 7", display: "flex", flexDirection: "column", gap: "16px" }}>
                          <div
                            style={{
                              backgroundColor: "#f8fafc",
                              border: "1px solid #f1f5f9",
                              padding: "16px",
                              borderRadius: "12px",
                              minHeight: "80px",
                            }}
                          >
                            <MarkdownRenderer
                              content={ann.description}
                              style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6" }}
                              codeStyle={{ backgroundColor: "#e0e7ff", color: "#3730a3", border: "1px solid #c7d2fe" }}
                              onHgLink={(alias) => openGuideFeature(ann, alias)}
                            />
                          </div>

                          {(visibleFields.tag || visibleFields.selector) && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                              {visibleFields.tag && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span
                                    style={{
                                      color: "#94a3b8",
                                      fontSize: "10px",
                                      fontWeight: "900",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.1em",
                                    }}
                                  >
                                    {t.tagName}
                                  </span>
                                  <span
                                    style={{
                                      backgroundColor: "#e2e8f0",
                                      color: "#475569",
                                      fontWeight: "bold",
                                      padding: "6px 12px",
                                      borderRadius: "8px",
                                      fontSize: "13px",
                                      width: "fit-content",
                                    }}
                                  >
                                    {ann.tagName}
                                  </span>
                                </div>
                              )}
                              {visibleFields.selector && (
                                <div
                                  style={{ display: "flex", flexDirection: "column", gap: "4px", overflow: "hidden" }}
                                >
                                  <span
                                    style={{
                                      color: "#94a3b8",
                                      fontSize: "10px",
                                      fontWeight: "900",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.1em",
                                    }}
                                  >
                                    {t.selector}
                                  </span>
                                  <code
                                    style={{
                                      backgroundColor: "#eef2ff",
                                      color: "#4f46e5",
                                      border: "1px solid #e0e7ff",
                                      fontSize: "10px",
                                      padding: "6px 8px",
                                      borderRadius: "6px",
                                      fontFamily: "monospace",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {ann.selector}
                                  </code>
                                </div>
                              )}
                            </div>
                          )}

                          {visibleFields.url && ann.url && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                color: "rgba(99, 102, 241, 0.6)",
                                fontSize: "12px",
                              }}
                            >
                              <ExternalLink style={{ width: "12px", height: "12px" }} />
                              <span style={{ textDecoration: "underline", opacity: 0.8 }}>{ann.url}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {idx < filteredAnnotations.length - 1 && (
                        <div style={{ backgroundColor: "#f1f5f9", height: "1px", margin: "8px 0" }} />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {isEditModalOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsEditModalOpen(false);
            }
          }}
        >
          <div className="bg-base-100 rounded-2xl border border-base-300 shadow-2xl w-full max-w-2xl @min-[54rem]:max-w-3xl h-[90%] max-h-[90vh] overflow-hidden p-5 flex flex-col gap-3 relative isolate">
            <div className="flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black">{t.editPolicy}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-full text-base-content/40 hover:text-base-content hover:bg-base-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="flex flex-col gap-1.5 shrink-0">
              <span className="text-[10px] font-medium tracking-wide text-base-content/50">{t.roleLabel}</span>
              <Input
                id="app-edit-role"
                ref={roleInputRef}
                value={editForm.role}
                onChange={(e) => setEditField("role", e.target.value)}
                onCompositionEnd={(e) => setEditField("role", e.currentTarget.value)}
                className="h-9 text-sm"
              />
            </label>

            <div className="flex flex-col gap-1.5 flex-1 min-h-[160px] overflow-hidden relative z-10">
              <span className="text-[10px] font-medium tracking-wide text-base-content/50 shrink-0">{t.descLabel}</span>
              <GuideDescriptionField
                id="app-edit-desc"
                editorRef={descEditorRef}
                value={editForm.description}
                onChange={(description) => setEditField("description", description)}
                placeholder="Description (Markdown format supported)..."
                t={t}
                lang={lang}
              />
            </div>

            <div className="min-h-0 overflow-y-auto flex flex-col gap-3 relative z-0">
              <label className="flex flex-col gap-1.5 shrink-0">
                <span className="text-[10px] font-medium tracking-wide text-base-content/50 flex items-center gap-1">
                  <Globe className="w-3 h-3 text-primary" /> {t.hostPatternLabel}
                </span>
                <Input
                  ref={hostPatternInputRef}
                  value={editForm.hostPattern}
                  onChange={(e) => setEditField("hostPattern", e.target.value)}
                  onCompositionEnd={(e) => setEditField("hostPattern", e.currentTarget.value)}
                  placeholder={t.hostPatternPlaceholder}
                  className="h-8 text-xs font-mono"
                />
                <CoverageBanner coverage={editCoverage} t={t} />
                <HostCoveragePanel coverage={editCoverage} t={t} />
              </label>

              <label className="flex flex-col gap-1.5 shrink-0">
                <span className="text-[10px] font-medium tracking-wide text-base-content/50 flex items-center gap-1">
                  <FolderTree className="w-3 h-3 text-secondary" /> {t.pathPatternLabel}
                </span>
                <Input
                  ref={pathPatternInputRef}
                  value={editForm.pathPattern}
                  onChange={(e) => setEditField("pathPattern", e.target.value)}
                  onCompositionEnd={(e) => setEditField("pathPattern", e.currentTarget.value)}
                  placeholder={t.pathPatternPlaceholder}
                  className="h-8 text-xs font-mono"
                />
              </label>

              <div className="flex items-start gap-2 rounded-xl bg-info/8 border border-info/15 p-3 shrink-0">
                <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                <p className="text-[11px] text-base-content/60 leading-relaxed m-0">{t.patternHelp}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 shrink-0">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium tracking-wide text-base-content/50 flex items-center gap-1">
                    <Globe className="w-3 h-3 text-base-content/40" /> {t.domainLabel}
                  </span>
                  <Input
                    ref={domainInputRef}
                    value={editForm.domain}
                    onChange={(e) => setEditField("domain", e.target.value)}
                    onCompositionEnd={(e) => setEditField("domain", e.currentTarget.value)}
                    placeholder="www.example.com"
                    className="h-8 text-xs font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium tracking-wide text-base-content/50">{t.urlLabel}</span>
                  <Input
                    ref={urlInputRef}
                    value={editForm.url}
                    onChange={(e) => setEditField("url", e.target.value)}
                    onCompositionEnd={(e) => setEditField("url", e.currentTarget.value)}
                    className="h-8 text-xs font-mono"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1 shrink-0 relative z-40 bg-base-100 pointer-events-auto">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs font-bold"
                onClick={() => setIsEditModalOpen(false)}
              >
                {t.cancel}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 gap-1.5 text-xs font-black"
                type="button"
                onClick={() => void handleUpdate()}
                disabled={!editForm.role.trim() || isSavingEdit}
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingEdit ? "..." : t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {zoomImage && (
        <div
          className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
          onClick={() => setZoomImage(null)}
        >
          <button type="button" className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors">
            <X className="w-7 h-7" />
          </button>
          <img src={zoomImage} alt="" className="max-w-full max-h-full shadow-2xl rounded-lg" />
        </div>
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        title={t.delete}
        message={t.deleteConfirm}
        type="danger"
      />
    </div>
  );
}
