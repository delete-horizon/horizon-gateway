import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ApiRequestDraft,
  type ApiRequestFieldConfig,
  ApiRequestForm,
  type ApiRequestSuggestionContext,
  autocompleteBodiesAtom,
  autocompleteHeadersAtom,
  autocompleteHeaderValuesAtom,
  autocompleteOriginsAtom,
  autocompleteParamValuesAtom,
  autocompletePathnamesAtom,
  autocompletePathnamesByOriginAtom,
  buildRequestUrl,
  collectDraftHeaders,
  createDefaultDraft,
  type FieldControl,
  FieldPermissionsCard,
  mergeFieldConfig,
  mergeSuggestionLists,
  methodStyle,
  pathnamesForOrigin,
  SCHEMA_FIELD_CONFIG,
  useRecordApiRequestAutocomplete,
} from "@/entities/api-request";
import { languageAtom, usePromiseModal } from "@/entities/app";
import {
  ApiResponseViewer,
  apiClientPrefillAtom,
  buildApiResponseViewerLabels,
  copyApiExchangeAsCardHtml,
  copyApiExchangeAsMarkdown,
  savedJsonSchemasAtom,
  validateJsonSchema,
} from "@/entities/sandbox";
import { hubSchemaExplorerSeedAtom } from "@/features/panel-stack";
import type { ApiLogEntry, Domain, DomainApiLoggingLink } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { useIsHubSurfaceEmbed } from "@/shared/lib/hub/HubSurfaceEmbedContext";
import {
  findMatchingEndpoint,
  type OpenApiSpec,
  type ParsedEndpoint,
  parseOpenApiSpec,
  type TagGroup,
} from "@/shared/lib/openapi-parser";
import { type EmbedMode, useEmbedMode } from "@/shared/lib/tauri/useEmbedMode";
import { Badge } from "@/shared/ui/badge/badge";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { Input } from "@/shared/ui/input/Input";
import { SegmentedTabs } from "@/shared/ui/tabs";
import { H1, P } from "@/shared/ui/typography/typography";
import { en } from "./en";
import { ko } from "./ko";
import {
  apiSchemaFieldOverridesAtom,
  apiSchemaFormsAtom,
  apiSchemaSearchAtom,
  apiSchemaSelectedDomainIdAtom,
  apiSchemaSelectedEndpointAtom,
  type EndpointFormState,
} from "./store";

export const Route = createFileRoute("/apis/schema/")({
  validateSearch: (search: Record<string, unknown>) => ({
    d:
      typeof search.d === "number"
        ? search.d
        : typeof search.d === "string"
          ? Number(search.d) || undefined
          : undefined,
  }),
  component: ApiSchemaRoutePage,
});

function ApiSchemaRoutePage() {
  const embedMode = useEmbedMode();
  const { d } = Route.useSearch();
  return <ApiSchemaPage initialDomainId={d} embedMode={embedMode} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTextStatusColor(code: number): "green" | "red" | "amber" | "blue" | "slate" {
  if (code < 300) {
    return "green";
  }
  if (code < 400) {
    return "blue";
  }
  if (code < 500) {
    return "amber";
  }
  return "red";
}

// ── Tag group (collapsible) ─────────────────────────────────────────────────

function TagSection({
  group,
  selected,
  onSelect,
  search,
}: {
  group: TagGroup;
  selected: ParsedEndpoint | null;
  onSelect: (ep: ParsedEndpoint) => void;
  search: string;
}) {
  const [open, setOpen] = useState(true);
  const lowerSearch = search.toLowerCase();

  const filtered = useMemo(() => {
    if (!lowerSearch) {
      return group.endpoints;
    }
    return group.endpoints.filter(
      (ep) =>
        ep.path.toLowerCase().includes(lowerSearch) ||
        ep.summary?.toLowerCase().includes(lowerSearch) ||
        ep.operationId?.toLowerCase().includes(lowerSearch) ||
        ep.method.toLowerCase().includes(lowerSearch),
    );
  }, [group.endpoints, lowerSearch]);

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 text-[10px] font-black text-base-content/40 hover:text-base-content/80 uppercase tracking-widest transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {group.tag} ({filtered.length})
      </button>
      {open && (
        <ul>
          {filtered.map((ep) => {
            const key = `${ep.method}-${ep.path}`;
            const isSelected = selected && selected.method === ep.method && selected.path === ep.path;
            const ms = methodStyle(ep.method);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 text-xs transition-all border ${
                    isSelected ? "bg-primary/10 border-primary/30 shadow-sm" : "hover:bg-base-200 border-transparent"
                  }`}
                  onClick={() => onSelect(ep)}
                >
                  <Badge
                    variant={{ color: ms.color, size: "sm" }}
                    className="w-14 text-center shrink-0 font-black tracking-tighter"
                  >
                    {ep.method.toUpperCase()}
                  </Badge>
                  <span
                    className={`font-mono truncate ${isSelected ? "text-primary font-bold" : "text-base-content/80 font-medium"}`}
                  >
                    {ep.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── History Modal ───────────────────────────────────────────────────────────

function LogHistoryModal({
  method,
  path,
  host,
  onSelect,
  onClose,
}: {
  method: string;
  path: string;
  host: string;
  onSelect: (log: ApiLogEntry) => void;
  onClose: () => void;
}) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const res = await commands
          .getApiLogs({
            date: today,
            domainFilter: path,
            methodFilter: method.toUpperCase(),
            hostFilter: host,
            exactMatch: true,
          })
          .then(unwrap);
        if (res.success) {
          setLogs(res.data ?? []);
        }
      } catch (e) {
        console.error("fetch history logs:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [method, path, host]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl bg-base-100 max-h-[80vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 border-base-300">
        <div className="p-5 border-b border-base-300 flex items-center justify-between">
          <h3 className="font-black text-base-content flex items-center gap-3">
            <Clock className="w-5 h-5 text-primary" />
            {t.requestHistoryToday}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-base-content/40 hover:text-base-content/80 hover:bg-base-200 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-base-content/30 font-bold uppercase tracking-widest text-xs">
              {t.noLogsFound}
            </div>
          ) : (
            <ul className="space-y-3 p-3">
              {logs.map((log) => (
                <li key={log.id}>
                  <button
                    type="button"
                    className="w-full text-left p-4 rounded-xl border border-base-300 hover:border-primary/50 hover:bg-primary/5 transition-all group shadow-sm hover:shadow-md"
                    onClick={() => onSelect(log)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={{ color: getTextStatusColor(log.status_code ?? 0), size: "sm" }}
                          className="font-black tabular-nums"
                        >
                          {log.status_code ?? "ERR"}
                        </Badge>
                        <span className="text-[10px] text-base-content/40 font-black uppercase tracking-widest">
                          {log.timestamp.replace("T", " ").split(".")[0]}
                        </span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        {t.load}
                      </span>
                    </div>
                    {(log.request_body || log.request_headers) && (
                      <div className="text-[10px] text-base-content/30 font-mono truncate bg-base-200/50 p-1.5 rounded border border-base-300/50 group-hover:border-primary/20 transition-colors">
                        {log.request_body ? t.hasBody : t.noBody} ·{" "}
                        {log.request_headers ? t.headersCount(Object.keys(log.request_headers).length) : t.noHeaders}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function EndpointDetail({
  endpoint,
  baseUrl,
  host,
  domainId,
  allEndpoints,
  serverOrigins,
}: {
  endpoint: ParsedEndpoint;
  baseUrl: string;
  host: string;
  domainId: number;
  allEndpoints: ParsedEndpoint[];
  serverOrigins: string[];
}) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const ms = methodStyle(endpoint.method);

  const [allForms, setAllForms] = useAtom(apiSchemaFormsAtom);
  const storedOrigins = useAtomValue(autocompleteOriginsAtom);
  const storedPathnames = useAtomValue(autocompletePathnamesAtom);
  const storedPathnamesByOrigin = useAtomValue(autocompletePathnamesByOriginAtom);
  const storedBodies = useAtomValue(autocompleteBodiesAtom);
  const storedParamValues = useAtomValue(autocompleteParamValuesAtom);
  const storedHeaderKeys = useAtomValue(autocompleteHeadersAtom);
  const storedHeaderValues = useAtomValue(autocompleteHeaderValuesAtom);
  const recordAutocomplete = useRecordApiRequestAutocomplete(endpoint);
  const savedJsonSchemas = useAtomValue(savedJsonSchemasAtom);

  const endpointKey = `${domainId}:${endpoint.method}:${endpoint.path}`;

  const draft = useMemo<ApiRequestDraft>(() => {
    const saved = allForms[endpointKey];
    return createDefaultDraft(endpoint, baseUrl, saved);
  }, [allForms, endpointKey, endpoint, baseUrl]);

  const updateDraft = useCallback(
    (updates: Partial<ApiRequestDraft>) => {
      setAllForms((prev) => ({
        ...prev,
        [endpointKey]: {
          ...prev[endpointKey],
          paramValues: draft.paramValues,
          bodyText: draft.bodyText,
          headers: draft.headers,
          origin: draft.origin,
          pathname: draft.pathname,
          response: prev[endpointKey]?.response ?? null,
          error: prev[endpointKey]?.error ?? null,
          ...updates,
        },
      }));
    },
    [draft, endpointKey, setAllForms],
  );

  const formState = allForms[endpointKey];
  const response = formState?.response ?? null;
  const error = formState?.error ?? null;
  const fieldOverrides = useAtomValue(apiSchemaFieldOverridesAtom);

  const fieldConfig = useMemo(() => mergeFieldConfig(SCHEMA_FIELD_CONFIG, fieldOverrides), [fieldOverrides]);

  const navigate = useNavigate();
  const setClientPrefill = useSetAtom(apiClientPrefillAtom);

  const suggestions = useMemo<ApiRequestSuggestionContext>(
    () => ({
      origins: mergeSuggestionLists([baseUrl], serverOrigins, storedOrigins),
      pathnames: mergeSuggestionLists(
        allEndpoints.map((item) => item.path),
        [endpoint.path],
        storedPathnames,
        pathnamesForOrigin(storedPathnamesByOrigin, draft.origin),
      ),
      paramValues: storedParamValues,
      headerKeys: storedHeaderKeys,
      headerValues: storedHeaderValues,
      bodies: mergeSuggestionLists(storedBodies, draft.bodyText ? [draft.bodyText] : []),
    }),
    [
      allEndpoints,
      baseUrl,
      draft.bodyText,
      draft.origin,
      endpoint.path,
      serverOrigins,
      storedBodies,
      storedHeaderKeys,
      storedHeaderValues,
      storedOrigins,
      storedParamValues,
      storedPathnames,
      storedPathnamesByOrigin,
    ],
  );

  // Loading state (not persisted)
  const [sending, setSending] = useState(false);
  const [enableSchemaValidation, setEnableSchemaValidation] = useState(false);
  const [schemaText, setSchemaText] = useState("");
  const [schemaValidationResult, setSchemaValidationResult] = useState<{
    valid: boolean;
    errors: string | null;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { alert: promiseAlert } = usePromiseModal();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!enableSchemaValidation || !response?.body) {
      setSchemaValidationResult(null);
      return;
    }

    const bodyStr = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
    if (bodyStr.length > 500_000) {
      setSchemaValidationResult({
        valid: false,
        errors: `Payload too large for validation (${(bodyStr.length / 1024).toFixed(0)} KB). Limit: 500 KB.`,
      });
      return;
    }
    if (!schemaText.trim()) {
      setSchemaValidationResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const result = await validateJsonSchema(bodyStr, schemaText);
        setSchemaValidationResult(result);
      } catch (err: unknown) {
        setSchemaValidationResult({
          valid: false,
          errors: err instanceof Error ? err.message : "Schema validation execution failed",
        });
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [enableSchemaValidation, response, schemaText]);

  const buildUrl = useCallback(() => buildRequestUrl(draft, endpoint), [draft, endpoint]);

  const updateFormMeta = useCallback(
    (updates: Partial<Pick<EndpointFormState, "response" | "error">>) => {
      setAllForms((prev) => ({
        ...prev,
        [endpointKey]: {
          ...draft,
          response: prev[endpointKey]?.response ?? null,
          error: prev[endpointKey]?.error ?? null,
          ...updates,
        },
      }));
    },
    [draft, endpointKey, setAllForms],
  );

  const handleSend = async () => {
    setSending(true);
    updateFormMeta({ response: null, error: null });
    try {
      const url = buildUrl();
      const headers = collectDraftHeaders(draft, endpoint);

      const res = await commands
        .sendApiRequest({
          method: endpoint.method.toUpperCase(),
          url,
          headers,
          body: draft.bodyText.trim() || null,
        })
        .then(unwrap);

      const parseResponseBody = (raw: string) => {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      };

      if (res.success && res.data) {
        recordAutocomplete(draft, {
          responseBody: parseResponseBody(res.data.body),
          responseHeaders: res.data.headers,
        });
        updateFormMeta({ response: res.data, error: null });
      } else {
        recordAutocomplete(draft);
        updateFormMeta({ error: res.message, response: res.data ?? null });
      }
    } catch (e) {
      updateFormMeta({ error: String(e), response: null });
    } finally {
      setSending(false);
    }
  };

  const handleLoadLog = async (log: ApiLogEntry) => {
    setHistoryOpen(false);

    const today = new Date().toISOString().split("T")[0];
    let full = log;
    try {
      const res = await commands.getApiLogDetail({ id: log.id, date: today }).then(unwrap);
      if (res.success && res.data) {
        full = res.data;
      }
    } catch {
      // use list stub
    }

    const headerRows = full.request_headers
      ? Object.entries(full.request_headers)
          .filter(([key]) => !["host", "content-length", "connection"].includes(key.toLowerCase()))
          .map(([key, value]) => ({ key, value }))
      : [{ key: "", value: "" }];

    updateDraft({
      bodyText: full.request_body ?? draft.bodyText,
      headers: headerRows.length > 0 ? headerRows : [{ key: "", value: "" }],
    });
  };

  const getRequestHeaders = useCallback(() => collectDraftHeaders(draft, endpoint), [draft, endpoint]);

  const handleOpenInClient = useCallback(() => {
    setClientPrefill({
      method: endpoint.method.toUpperCase(),
      url: buildUrl(),
      headers: getRequestHeaders(),
      body: draft.bodyText,
    });
    navigate({ to: "/apis/client" });
  }, [buildUrl, draft.bodyText, endpoint.method, getRequestHeaders, navigate, setClientPrefill]);

  const buildCopyInput = useCallback(() => {
    if (!response) {
      return null;
    }
    return {
      method: endpoint.method,
      url: buildUrl(),
      requestHeaders: getRequestHeaders(),
      requestBody: draft.bodyText,
      response: {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        elapsedMs: response.elapsedMs,
      },
    };
  }, [buildUrl, draft.bodyText, endpoint.method, getRequestHeaders, response]);

  const handleCopyHtml = useCallback(async () => {
    setIsDropdownOpen(false);
    const input = buildCopyInput();
    if (!input) {
      return;
    }
    try {
      await copyApiExchangeAsCardHtml(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      promiseAlert(t.copied, t.copiedDesc);
    } catch (err) {
      console.error("Failed to copy HTML:", err);
    }
  }, [buildCopyInput, promiseAlert, t.copied, t.copiedDesc]);

  const handleCopyMarkdown = useCallback(async () => {
    setIsDropdownOpen(false);
    const input = buildCopyInput();
    if (!input) {
      return;
    }
    try {
      await copyApiExchangeAsMarkdown(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      promiseAlert(t.copied, t.copiedDesc);
    } catch (err) {
      console.error("Failed to copy Markdown:", err);
    }
  }, [buildCopyInput, promiseAlert, t.copied, t.copiedDesc]);

  const openApiParams = endpoint.parameters.filter((p) => p.in !== "cookie");

  return (
    <div className="space-y-3 relative">
      {historyOpen && (
        <LogHistoryModal
          host={host}
          method={endpoint.method}
          path={endpoint.path}
          onClose={() => setHistoryOpen(false)}
          onSelect={handleLoadLog}
        />
      )}

      <ApiRequestForm
        draft={draft}
        onChange={updateDraft}
        suggestions={suggestions}
        endpoint={endpoint}
        method={endpoint.method}
        labels={{ origin: t.origin, pathname: t.pathname }}
        config={fieldConfig}
        className="space-y-3"
      >
        <div className={`rounded-xl border p-4 shadow-sm ${ms.bg}`}>
          <div className="flex items-center gap-3 mb-4">
            <Badge variant={{ color: ms.color, size: "md" }} className="font-black tracking-tight shrink-0">
              {endpoint.method.toUpperCase()}
            </Badge>
            <span className="text-xs font-black text-base-content/50 uppercase tracking-widest">
              {endpoint.summary ?? endpoint.path}
            </span>
          </div>

          <ApiRequestForm.Header
            method={endpoint.method}
            actions={
              <>
                {response && (
                  <div className="relative inline-block text-left" ref={dropdownRef}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsDropdownOpen((prev) => !prev)}
                      className="gap-1.5 shrink-0 flex items-center bg-base-100 border-base-300 font-bold tracking-tight"
                      type="button"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-success" />
                          <span className="text-success">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{t.btnCopy}</span>
                          <ChevronDown className="w-3 h-3 text-base-content/40" />
                        </>
                      )}
                    </Button>

                    {isDropdownOpen && (
                      <div className="absolute right-0 mt-1 w-44 bg-base-100 border border-base-300 rounded-xl shadow-xl z-50 py-1 overflow-hidden backdrop-blur-md bg-base-100/95">
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2 text-xs hover:bg-base-200 text-base-content font-bold transition-colors cursor-pointer"
                          onClick={handleCopyHtml}
                        >
                          {t.copyHtml}
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2 text-xs hover:bg-base-200 border-t border-base-200 text-base-content font-bold transition-colors cursor-pointer"
                          onClick={handleCopyMarkdown}
                        >
                          {t.copyMarkdown}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-2 shrink-0 flex items-center bg-base-100 border-base-300 font-bold tracking-tight"
                  onClick={handleOpenInClient}
                  title={t.openInClient}
                  type="button"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t.openInClient}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-2 shrink-0 flex items-center bg-base-100 border-base-300 font-bold tracking-tight"
                  onClick={() => setHistoryOpen(true)}
                  title={t.history}
                  type="button"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {t.history}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="gap-2 shrink-0 flex items-center font-bold tracking-tight shadow-lg shadow-primary/20"
                  disabled={sending}
                  onClick={handleSend}
                  type="button"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {t.send}
                </Button>
              </>
            }
          />
        </div>

        <ApiRequestForm.Params parameters={openApiParams} title={t.parameters} />

        <ApiRequestForm.When when={!!endpoint.requestBody}>
          <ApiRequestForm.Body title={t.body} contentType={endpoint.requestBody?.contentType} />
        </ApiRequestForm.When>

        <ApiRequestForm.Headers
          title={t.customHeaders}
          labels={{
            addHeader: t.addHeader,
            key: t.headerKey,
            value: t.headerValue,
          }}
        />
      </ApiRequestForm>

      {/* Reusable Response Viewer Component */}
      <ApiResponseViewer
        loading={sending}
        response={response}
        error={error}
        t={buildApiResponseViewerLabels(t)}
        showSchemaTab={true}
        enableSchemaValidation={enableSchemaValidation}
        onToggleSchemaValidation={setEnableSchemaValidation}
        schemaText={schemaText}
        onChangeSchemaText={setSchemaText}
        schemaValidationResult={schemaValidationResult}
        savedJsonSchemas={savedJsonSchemas}
        hideOnEmpty={true}
        heightClass="min-h-[560px] mt-4"
      />
    </div>
  );
}

// ── Schema Options ───────────────────────────────────────────────────────────

type SchemaPageTab = "endpoints" | "options";

function SchemaOptionsPanel() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [fieldOverrides, setFieldOverrides] = useAtom(apiSchemaFieldOverridesAtom);
  const fieldConfig = useMemo(() => mergeFieldConfig(SCHEMA_FIELD_CONFIG, fieldOverrides), [fieldOverrides]);

  const handleConfigChange = useCallback(
    (field: keyof ApiRequestFieldConfig, control: Partial<FieldControl>) => {
      setFieldOverrides((prev) => ({
        ...prev,
        [field]: { ...prev[field], ...control },
      }));
    },
    [setFieldOverrides],
  );

  return (
    <section className="space-y-2 min-w-0">
      <h2 className="text-sm font-semibold text-base-content">{t.optionsTitle}</h2>
      <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
        <p className="text-xs text-base-content/55 leading-relaxed">{t.optionsSubtitle}</p>

        <FieldPermissionsCard
          title={t.fieldSettings}
          labels={{
            method: t.fieldMethod,
            origin: t.origin,
            pathname: t.pathname,
            params: t.parameters,
            body: t.body,
            headers: t.customHeaders,
          }}
          config={fieldConfig}
          onConfigChange={handleConfigChange}
        />
      </Card>
    </section>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function ApiSchemaPage({
  initialDomainId,
  embedMode = "standalone",
}: {
  initialDomainId?: number;
  embedMode?: EmbedMode;
} = {}) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const hubSurfaceEmbed = useIsHubSurfaceEmbed();
  const isEmbedded = embedMode !== "standalone" || hubSurfaceEmbed;
  const routeSearch = useSearch({ strict: false });
  const [domains, setDomains] = useState<Domain[]>([]);
  const [links, setLinks] = useState<DomainApiLoggingLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDomainId, setSelectedDomainId] = useAtom(apiSchemaSelectedDomainIdAtom);

  useEffect(() => {
    const d = initialDomainId ?? (typeof routeSearch.d === "number" ? routeSearch.d : undefined);
    if (d) {
      setSelectedDomainId(d);
    }
  }, [initialDomainId, routeSearch.d, setSelectedDomainId]);

  const [schemaLoading, setSchemaLoading] = useState(false);
  const [parsedSpec, setParsedSpec] = useState<OpenApiSpec | null>(null);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [allEndpoints, setAllEndpoints] = useState<ParsedEndpoint[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [search, setSearch] = useAtom(apiSchemaSearchAtom);
  const [selectedEndpoint, setSelectedEndpoint] = useAtom(apiSchemaSelectedEndpointAtom);
  const [activeTab, setActiveTab] = useState<SchemaPageTab>("endpoints");
  const [explorerSeed, setExplorerSeed] = useAtom(hubSchemaExplorerSeedAtom);
  const pendingEndpointMatchRef = useRef<{ method: string; path: string } | null>(null);
  const [handoffMatchNotice, setHandoffMatchNotice] = useState<{
    ok: boolean;
    method: string;
    path: string;
  } | null>(null);

  useEffect(() => {
    if (!explorerSeed) {
      return;
    }

    if (explorerSeed.domainId) {
      setSelectedDomainId(explorerSeed.domainId);
    }

    pendingEndpointMatchRef.current = {
      method: explorerSeed.method,
      path: explorerSeed.path,
    };
    setHandoffMatchNotice(null);
    setExplorerSeed(null);
  }, [explorerSeed, setExplorerSeed, setSelectedDomainId]);

  useEffect(() => {
    (async () => {
      try {
        const [dRes, lRes] = await Promise.all([
          commands.getDomains().then(unwrap),
          commands.getDomainApiLoggingLinks().then(unwrap),
        ]);
        if (dRes.success) {
          setDomains(dRes.data ?? []);
        }
        if (lRes.success) {
          setLinks(lRes.data ?? []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Domain map
  const domainMap = useMemo(() => {
    const m = new Map<number, Domain>();
    for (const d of domains) {
      m.set(d.id, d);
    }
    return m;
  }, [domains]);

  // Selected domain link info & schema URL state
  const currentLink = useMemo(() => links.find((l) => l.domainId === selectedDomainId), [links, selectedDomainId]);
  const [schemaUrlInput, setSchemaUrlInput] = useState(currentLink?.schemaUrl ?? "");
  const [savingSchema, setSavingSchema] = useState(false);
  const [downloadingSchema, setDownloadingSchema] = useState(false);
  const [schemaActionMessage, setSchemaActionMessage] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savingBody, setSavingBody] = useState(false);

  useEffect(() => {
    setSchemaUrlInput(currentLink?.schemaUrl ?? "");
    setSchemaActionMessage(null);
  }, [currentLink?.schemaUrl]);

  const loadSchemaForDomain = useCallback(
    async (domainId: number) => {
      setSchemaLoading(true);
      setParseError(null);
      try {
        const res = await commands.getApiSchemaContent({ domainId }).then(unwrap);
        if (res.success && res.data) {
          const { spec, endpoints, tagGroups: tg } = parseOpenApiSpec(res.data);
          setParsedSpec(spec);
          setTagGroups(tg);
          setAllEndpoints(endpoints);
        } else {
          setParsedSpec(null);
          setTagGroups([]);
          setAllEndpoints([]);
          setParseError(t.noSchemaError);
        }
      } catch (e) {
        setParseError(t.parseFailedError(String(e)));
      } finally {
        setSchemaLoading(false);
      }
    },
    [t],
  );

  const handleSaveSchemaUrl = useCallback(async () => {
    if (selectedDomainId === null) {
      return;
    }
    setSavingSchema(true);
    setSchemaActionMessage(null);
    try {
      await commands
        .setDomainApiLogging({
          domainId: selectedDomainId,
          loggingEnabled: currentLink?.loggingEnabled ?? true,
          bodyEnabled: currentLink?.bodyEnabled ?? false,
          schemaUrl: schemaUrlInput.trim() || null,
        })
        .then(unwrap);
      const res = await commands.getDomainApiLoggingLinks().then(unwrap);
      if (res.success) {
        setLinks(res.data ?? []);
      }
      setSchemaActionMessage({ ok: true, msg: t.schemaSaved });
    } catch (e) {
      setSchemaActionMessage({ ok: false, msg: String(e) });
    } finally {
      setSavingSchema(false);
    }
  }, [selectedDomainId, currentLink, schemaUrlInput, t]);

  const handleToggleBody = useCallback(async () => {
    if (selectedDomainId === null) {
      return;
    }
    setSavingBody(true);
    try {
      await commands
        .setDomainApiLogging({
          domainId: selectedDomainId,
          loggingEnabled: currentLink?.loggingEnabled ?? true,
          bodyEnabled: !(currentLink?.bodyEnabled ?? false),
          schemaUrl: currentLink?.schemaUrl ?? null,
        })
        .then(unwrap);
      const res = await commands.getDomainApiLoggingLinks().then(unwrap);
      if (res.success) {
        setLinks(res.data ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingBody(false);
    }
  }, [selectedDomainId, currentLink]);

  const handleDownloadSchema = useCallback(async () => {
    if (selectedDomainId === null) {
      return;
    }
    const url = schemaUrlInput.trim() || (currentLink?.schemaUrl ?? "").trim();
    if (!url) {
      setSchemaActionMessage({ ok: false, msg: t.noSchemaDownloadAction });
      return;
    }
    setDownloadingSchema(true);
    setSchemaActionMessage(null);
    try {
      if (schemaUrlInput.trim() !== (currentLink?.schemaUrl ?? "")) {
        await commands
          .setDomainApiLogging({
            domainId: selectedDomainId,
            loggingEnabled: currentLink?.loggingEnabled ?? true,
            bodyEnabled: currentLink?.bodyEnabled ?? false,
            schemaUrl: url,
          })
          .then(unwrap);
        const lRes = await commands.getDomainApiLoggingLinks().then(unwrap);
        if (lRes.success) {
          setLinks(lRes.data ?? []);
        }
      }

      const res = await commands.downloadApiSchema({ domainId: selectedDomainId, url }).then(unwrap);
      if (res.success) {
        setSchemaActionMessage({
          ok: true,
          msg: t.downloadSuccess((res.data.sizeBytes ?? 0).toLocaleString()),
        });
        await loadSchemaForDomain(selectedDomainId);
      } else {
        setSchemaActionMessage({ ok: false, msg: t.downloadFailed(res.message) });
      }
    } catch (e) {
      setSchemaActionMessage({ ok: false, msg: t.downloadFailed(String(e)) });
    } finally {
      setDownloadingSchema(false);
    }
  }, [selectedDomainId, schemaUrlInput, currentLink, loadSchemaForDomain, t]);

  // Track domain change to prevent reset on remount
  const lastSelectedDomainRef = useRef<number | null>(selectedDomainId);

  // Load schema when domain selected
  useEffect(() => {
    if (selectedDomainId === null) {
      setParsedSpec(null);
      setTagGroups([]);
      setAllEndpoints([]);
      setParseError(null);
      setSelectedEndpoint(null);
      lastSelectedDomainRef.current = null;
      return;
    }

    // Reset ONLY if we're actually switching from one domain to ANOTHER
    const actuallyChanged =
      lastSelectedDomainRef.current !== null && lastSelectedDomainRef.current !== selectedDomainId;
    lastSelectedDomainRef.current = selectedDomainId;

    if (actuallyChanged) {
      setSelectedEndpoint(null);
      setSearch("");
    }

    loadSchemaForDomain(selectedDomainId);
  }, [selectedDomainId, setSearch, setSelectedEndpoint, loadSchemaForDomain]);

  useEffect(() => {
    const pending = pendingEndpointMatchRef.current;
    if (!pending || schemaLoading) {
      return;
    }

    if (allEndpoints.length === 0) {
      if (!schemaLoading && (parseError || selectedDomainId !== null)) {
        pendingEndpointMatchRef.current = null;
        setHandoffMatchNotice({
          ok: false,
          method: pending.method,
          path: pending.path,
        });
      }
      return;
    }

    const matched = findMatchingEndpoint(allEndpoints, pending.method, pending.path);
    pendingEndpointMatchRef.current = null;

    if (matched) {
      setSelectedEndpoint(matched);
      setSearch(matched.path);
      setHandoffMatchNotice({
        ok: true,
        method: pending.method,
        path: pending.path,
      });
      return;
    }

    setSearch(pending.path);
    setHandoffMatchNotice({
      ok: false,
      method: pending.method,
      path: pending.path,
    });
  }, [allEndpoints, parseError, schemaLoading, selectedDomainId, setSearch, setSelectedEndpoint]);

  // Derive base URL from domain
  const baseUrl = useMemo(() => {
    if (!selectedDomainId) {
      return "";
    }
    const domain = domainMap.get(selectedDomainId);
    if (!domain) {
      return "";
    }

    // domain.url may already include scheme (https://...) or be bare (api.example.com)
    const domainOrigin = domain.url.startsWith("http") ? domain.url : `https://${domain.url}`;

    // If spec has servers, use the first one
    if (parsedSpec?.servers?.[0]?.url) {
      const serverUrl = parsedSpec.servers[0].url;
      // Absolute URL → use as-is
      if (serverUrl.startsWith("http")) {
        return serverUrl;
      }
      // Relative path → prepend domain origin
      return `${domainOrigin.replace(/\/+$/, "")}${serverUrl}`;
    }
    return domainOrigin;
  }, [selectedDomainId, domainMap, parsedSpec]);

  const serverOrigins = useMemo(
    () => parsedSpec?.servers?.map((server) => server.url).filter(Boolean) ?? [],
    [parsedSpec],
  );

  return (
    <div
      className={clsx(
        "flex flex-col gap-4 overflow-hidden",
        isEmbedded ? "h-full min-h-0 p-3 sm:p-4" : "h-[calc(100vh-10rem)]",
      )}
    >
      {!isEmbedded && (
        <header className="shrink-0 flex flex-col md:flex-row md:items-center md:justify-between border-b border-base-200 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-secondary/10 text-secondary rounded-lg">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <H1 className="text-2xl font-bold tracking-tight text-base-content">{t.title}</H1>
              <P className="text-base-content/60 text-xs font-medium">{t.subtitle}</P>
            </div>
          </div>
        </header>
      )}

      <div className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
        {handoffMatchNotice && (
          <div
            className={clsx(
              "shrink-0 rounded-xl border px-3 py-2 text-xs font-bold",
              handoffMatchNotice.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            {handoffMatchNotice.ok
              ? t.handoffEndpointMatched(handoffMatchNotice.method, handoffMatchNotice.path)
              : t.handoffEndpointNotFound(handoffMatchNotice.method, handoffMatchNotice.path)}
          </div>
        )}

        {/* Domain selector */}
        {!isEmbedded || !initialDomainId ? (
          <Card className="p-1 items-center gap-2 flex flex-wrap bg-base-100 border-base-300 shadow-xl rounded-2xl mb-6 relative z-10">
            <div className="pl-4 pr-3 py-2 flex items-center gap-3 border-r border-base-300 shrink-0">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-xs font-black text-base-content/40 whitespace-nowrap hidden sm:inline-block uppercase tracking-widest">
                {t.targetApi}
              </span>
            </div>

            <div className="relative flex-1 min-w-[200px] group/sel">
              <select
                id="domain-select"
                className="appearance-none w-full bg-transparent border-none py-2.5 pl-3 pr-10 text-sm font-bold text-base-content focus:ring-0 cursor-pointer outline-none transition-all"
                value={selectedDomainId ?? ""}
                onChange={(e) => setSelectedDomainId(e.target.value ? Number(e.target.value) : null)}
                disabled={loading}
              >
                <option value="" className="bg-base-100">
                  {t.selectDomain}
                </option>
                {domains.map((domain) => {
                  const link = links.find((l) => l.domainId === domain.id);
                  const hasUrl = Boolean(link?.schemaUrl);
                  return (
                    <option key={domain.id} value={domain.id} className="bg-base-100">
                      {domain.url} {hasUrl ? " (OpenAPI)" : ""}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30 pointer-events-none group-hover/sel:text-primary transition-colors" />
            </div>

            {schemaLoading ? (
              <div className="flex items-center gap-3 mr-5 p-2 px-4 bg-primary/5 text-primary rounded-xl text-xs font-black uppercase tracking-widest shadow-inner">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.parsingSchema}
              </div>
            ) : (
              parsedSpec && (
                <div className="hidden md:flex items-center gap-4 mr-4 p-2 px-4 bg-primary/10 text-primary rounded-xl text-xs font-bold border border-primary/20 animate-in fade-in slide-in-from-right-4 shrink-0 shadow-sm">
                  <span className="font-black uppercase tracking-tight">{parsedSpec.info.title}</span>
                  <span className="w-px h-3 bg-primary/20" />
                  <span className="font-mono tabular-nums">v{parsedSpec.info.version}</span>
                  <span className="w-px h-3 bg-primary/20" />
                  <span className="font-black uppercase tracking-tighter">{t.endpointsCount(allEndpoints.length)}</span>
                </div>
              )
            )}
          </Card>
        ) : (
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm shrink-0">
            <span className="text-sm font-bold text-slate-800 truncate">
              {selectedDomainId ? (domainMap.get(selectedDomainId)?.url ?? `Domain #${selectedDomainId}`) : "—"}
            </span>
            {schemaLoading ? (
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t.parsingSchema}
              </div>
            ) : (
              parsedSpec && (
                <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 shrink-0">
                  <span>{parsedSpec.info.title}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono">v{parsedSpec.info.version}</span>
                  <span className="text-slate-300">·</span>
                  <span>{t.endpointsCount(allEndpoints.length)}</span>
                </div>
              )
            )}
          </div>
        )}

        <SegmentedTabs<SchemaPageTab>
          value={activeTab}
          onChange={setActiveTab}
          size="sm"
          items={[
            { id: "endpoints", label: t.tabEndpoints, icon: BookOpen },
            { id: "options", label: t.tabOptions, icon: Settings2 },
          ]}
        />

        {activeTab === "options" && (
          <div className="space-y-6 max-w-2xl">
            {selectedDomainId && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold text-base-content">{t.schemaUrlLabel}</h2>
                <Card className="p-3 @min-[32rem]:p-4 space-y-3">
                  <p className="text-xs text-base-content/55 leading-relaxed">{t.noSchemaDownloadAction}</p>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={schemaUrlInput}
                      onChange={(e) => setSchemaUrlInput(e.target.value)}
                      placeholder={t.schemaPlaceholder}
                      className="flex-1 h-9 text-xs font-mono bg-base-100 border-base-300"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSaveSchemaUrl}
                        disabled={savingSchema || !selectedDomainId}
                      >
                        {savingSchema ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t.save}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleDownloadSchema}
                        disabled={downloadingSchema || !schemaUrlInput.trim() || !selectedDomainId}
                      >
                        {downloadingSchema ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        {t.download}
                      </Button>
                    </div>
                  </div>
                  {schemaActionMessage && (
                    <p className={clsx("text-xs font-bold", schemaActionMessage.ok ? "text-success" : "text-error")}>
                      {schemaActionMessage.msg}
                    </p>
                  )}
                </Card>
              </section>
            )}

            {selectedDomainId && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold text-base-content">{t.apiBodyLogging}</h2>
                <Card className="p-3 @min-[32rem]:p-4 space-y-3">
                  <p className="text-xs text-base-content/55 leading-relaxed">{t.apiBodyLoggingDesc}</p>
                  <div className="flex justify-end">
                    {savingBody ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    ) : (
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm shrink-0"
                        checked={currentLink?.bodyEnabled ?? false}
                        onChange={handleToggleBody}
                        disabled={!(currentLink?.loggingEnabled ?? false)}
                      />
                    )}
                  </div>
                </Card>
              </section>
            )}

            <SchemaOptionsPanel />
          </div>
        )}

        {activeTab === "endpoints" && (
          <>
            {/* Parse error & Schema URL Form */}
            {parseError && (
              <Card className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3 shrink-0">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs">
                  <X className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
                <p className="text-xs text-base-content/70">{t.noSchemaDownloadAction}</p>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={schemaUrlInput}
                    onChange={(e) => setSchemaUrlInput(e.target.value)}
                    placeholder={t.schemaPlaceholder}
                    className="flex-1 h-9 text-xs font-mono bg-base-100 border-base-300"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSaveSchemaUrl}
                      disabled={savingSchema || !selectedDomainId}
                    >
                      {savingSchema ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t.save}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleDownloadSchema}
                      disabled={downloadingSchema || !schemaUrlInput.trim() || !selectedDomainId}
                    >
                      {downloadingSchema ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {t.download}
                    </Button>
                  </div>
                </div>
                {schemaActionMessage && (
                  <p className={clsx("text-xs font-bold", schemaActionMessage.ok ? "text-success" : "text-error")}>
                    {schemaActionMessage.msg}
                  </p>
                )}
              </Card>
            )}

            {/* Main content: 2 panel */}
            {parsedSpec && (
              <div className="flex gap-4 flex-1 min-h-0">
                {/* Left: endpoint list */}
                <Card className="w-80 shrink-0 bg-base-100 border-base-300 flex flex-col shadow-xl overflow-hidden min-h-0 rounded-2xl transition-all">
                  <div className="p-4 border-b border-base-300 bg-base-200/50">
                    <div className="relative group/sch">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30 group-focus-within/sch:text-primary transition-colors" />
                      <Input
                        className="pl-10 h-10 text-xs w-full bg-base-100 border-base-300 focus:border-primary/50 font-bold tracking-tight"
                        placeholder={t.searchEndpoints}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 no-scrollbar">
                    {tagGroups.map((g) => (
                      <TagSection
                        key={g.tag}
                        group={g}
                        selected={selectedEndpoint}
                        onSelect={setSelectedEndpoint}
                        search={search}
                      />
                    ))}
                  </div>
                </Card>

                {/* Right: detail + request form (independently scrollable) */}
                <div className="flex-1 overflow-y-auto">
                  {selectedEndpoint && selectedDomainId ? (
                    <EndpointDetail
                      endpoint={selectedEndpoint}
                      baseUrl={baseUrl}
                      host={baseUrl.replace(/^https?:\/\//, "").split("/")[0]}
                      domainId={selectedDomainId}
                      allEndpoints={allEndpoints}
                      serverOrigins={serverOrigins}
                    />
                  ) : (
                    <Card className="p-12 flex flex-col items-center justify-center text-center min-h-[400px] bg-base-100 border-base-300 shadow-xl rounded-[2.5rem] animate-in fade-in zoom-in-95 duration-500">
                      <BookOpen className="w-16 h-16 text-base-content/10 mb-6 drop-shadow-xl" />
                      <p className="text-base-content/60 text-lg font-black tracking-tight uppercase">
                        {t.selectEndpoint}
                      </p>
                      <p className="text-base-content/20 text-xs mt-2 font-black uppercase tracking-[0.2em]">
                        {t.endpointsInfo(allEndpoints.length, tagGroups.length)}
                      </p>
                    </Card>
                  )}
                </div>
              </div>
            )}

            {/* Empty state when no domain selected */}
            {!parsedSpec && !schemaLoading && !parseError && (
              <Card className="flex-1 flex flex-col items-center justify-center text-center bg-base-100/50 backdrop-blur-sm border-base-300 shadow-2xl rounded-[3rem] animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="p-8 bg-primary/5 rounded-[2.5rem] mb-8 ring-1 ring-primary/10">
                  <BookOpen className="w-24 h-24 text-primary/40" />
                </div>
                <p className="text-base-content/60 text-xl font-black tracking-tighter uppercase mb-2">
                  {t.chooseDomainToStart}
                </p>
                <p className="text-base-content/20 text-xs font-black uppercase tracking-[0.2em]">
                  {t.registeredDomains(domains.length)}
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
