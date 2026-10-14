import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, Code, Copy, History as HistoryIcon, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ApiRequestDraft,
  ApiRequestForm,
  type ApiRequestSuggestionContext,
  autocompleteBodiesAtom,
  autocompleteHeadersAtom,
  autocompleteHeaderValuesAtom,
  autocompleteOriginsAtom,
  autocompleteParamValuesAtom,
  autocompletePathnamesAtom,
  autocompletePathnamesByOriginAtom,
  buildRequestUrlFromParts,
  CLIENT_FIELD_CONFIG,
  METHODS_WITH_BODY,
  mergeSuggestionLists,
  methodStyle,
  parseRequestUrl,
  pathnamesForOrigin,
  useRecordApiRequestAutocomplete,
} from "@/entities/api-request";
import { languageAtom, usePromiseModal } from "@/entities/app";
import {
  type ApiClientHistoryItem,
  ApiResponseViewer,
  type ApiResponseViewerProps,
  apiClientCurrentRequestAtom,
  apiClientHistoryAtom,
  apiClientLastResponseAtom,
  apiClientPrefillAtom,
  buildApiResponseViewerLabels,
  copyApiExchangeAsCardHtml,
  copyApiExchangeAsMarkdown,
  savedJsonSchemasAtom,
  validateJsonSchema,
} from "@/entities/sandbox";
import { commands, unwrap } from "@/shared/api";
import { useIsEmbeddedPage } from "@/shared/lib/tauri/useEmbedMode";
import { Badge } from "@/shared/ui/badge/badge";
import { Button } from "@/shared/ui/button/Button";
import { en } from "./en";
import { ko } from "./ko";

export const Route = createFileRoute("/apis/client/")({
  component: ApiClientPage,
});

const DEFAULT_REQUEST = parseRequestUrl("https://api.example.com/todos/1");

function createInitialDraft(): ApiRequestDraft {
  return {
    origin: DEFAULT_REQUEST.origin,
    pathname: DEFAULT_REQUEST.pathname,
    paramValues: {},
    bodyText: "",
    headers: [{ key: "Accept", value: "application/json" }],
    queryParams: DEFAULT_REQUEST.params,
  };
}

function headersToRecord(rows: ApiRequestDraft["headers"]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) {
      headers[row.key.trim()] = row.value.trim();
    }
  }
  return headers;
}

function ApiClientPage() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const isEmbedded = useIsEmbeddedPage();

  const [history, setHistory] = useAtom(apiClientHistoryAtom);
  const storedOrigins = useAtomValue(autocompleteOriginsAtom);
  const storedPathnames = useAtomValue(autocompletePathnamesAtom);
  const storedPathnamesByOrigin = useAtomValue(autocompletePathnamesByOriginAtom);
  const storedBodies = useAtomValue(autocompleteBodiesAtom);
  const storedParamValues = useAtomValue(autocompleteParamValuesAtom);
  const storedHeaderKeys = useAtomValue(autocompleteHeadersAtom);
  const storedHeaderValues = useAtomValue(autocompleteHeaderValuesAtom);
  const recordAutocomplete = useRecordApiRequestAutocomplete();
  const { alert: promiseAlert } = usePromiseModal();

  const setCurrentRequest = useSetAtom(apiClientCurrentRequestAtom);
  const setLastResponse = useSetAtom(apiClientLastResponseAtom);
  const savedJsonSchemas = useAtomValue(savedJsonSchemasAtom);
  const [prefill, setPrefill] = useAtom(apiClientPrefillAtom);

  const [method, setMethod] = useState("GET");
  const [draft, setDraft] = useState<ApiRequestDraft>(createInitialDraft);

  const updateDraft = useCallback((updates: Partial<ApiRequestDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  useEffect(() => {
    if (!prefill) {
      return;
    }
    setMethod(prefill.method);
    const parsed = parseRequestUrl(prefill.url);
    const headerRows = Object.entries(prefill.headers).map(([key, value]) => ({ key, value }));
    updateDraft({
      origin: parsed.origin,
      pathname: parsed.pathname,
      bodyText: prefill.body ?? "",
      headers: headerRows.length > 0 ? headerRows : [{ key: "", value: "" }],
      queryParams: parsed.params,
    });
    setPrefill(null);
  }, [prefill, setPrefill, updateDraft]);

  const queryParams = draft.queryParams ?? [{ key: "", value: "" }];
  const url = useMemo(
    () => buildRequestUrlFromParts(draft.origin, draft.pathname, queryParams),
    [draft.origin, draft.pathname, queryParams],
  );

  const suggestions = useMemo<ApiRequestSuggestionContext>(() => {
    const normalizedOrigin = draft.origin.replace(/\/+$/, "");
    return {
      origins: mergeSuggestionLists(
        storedOrigins,
        history.map((item) => parseRequestUrl(item.url).origin),
        draft.origin ? [draft.origin] : [],
      ),
      pathnames: mergeSuggestionLists(
        storedPathnames,
        pathnamesForOrigin(storedPathnamesByOrigin, draft.origin),
        history
          .filter((item) => parseRequestUrl(item.url).origin === normalizedOrigin)
          .map((item) => parseRequestUrl(item.url).pathname),
        draft.pathname ? [draft.pathname] : [],
      ),
      paramValues: storedParamValues,
      headerKeys: storedHeaderKeys,
      headerValues: storedHeaderValues,
      bodies: mergeSuggestionLists(storedBodies, draft.bodyText ? [draft.bodyText] : []),
    };
  }, [
    draft.bodyText,
    draft.origin,
    draft.pathname,
    history,
    storedBodies,
    storedHeaderKeys,
    storedHeaderValues,
    storedOrigins,
    storedParamValues,
    storedPathnames,
    storedPathnamesByOrigin,
  ]);

  useEffect(() => {
    setCurrentRequest({
      method,
      url,
      headers: headersToRecord(draft.headers),
      body: draft.bodyText,
    });
  }, [method, url, draft.headers, draft.bodyText, setCurrentRequest]);

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponseViewerProps["response"]>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [enableSchemaValidation, setEnableSchemaValidation] = useState(false);
  const [schemaText, setSchemaText] = useState(`{
  "type": "object",
  "properties": {
    "userId": { "type": "integer" },
    "id": { "type": "integer" },
    "title": { "type": "string" },
    "completed": { "type": "boolean" }
  },
  "required": ["id", "title"]
}`);
  const [schemaValidationResult, setSchemaValidationResult] = useState<{
    valid: boolean;
    errors: string | null;
  } | null>(null);

  useEffect(() => {
    if (!enableSchemaValidation || !response || !response.body) {
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

  const loadHistoryItem = (item: ApiClientHistoryItem) => {
    setMethod(item.method);
    const parsed = parseRequestUrl(item.url);
    const mappedHeaders = Object.entries(item.headers).map(([key, value]) => ({ key, value }));
    updateDraft({
      origin: parsed.origin,
      pathname: parsed.pathname,
      bodyText: item.body,
      headers: mappedHeaders.length > 0 ? mappedHeaders : [{ key: "", value: "" }],
      queryParams: parsed.params,
    });
  };

  const handleSend = async () => {
    setLoading(true);
    setResponse(null);
    setResponseError(null);

    const headersMap = headersToRecord(draft.headers);
    const paramValues = Object.fromEntries(
      queryParams.filter((row) => row.key.trim()).map((row) => [row.key, row.value]),
    );

    try {
      const res = await commands
        .sendApiRequest({
          method,
          url,
          headers: headersMap,
          body: draft.bodyText.trim() ? draft.bodyText : null,
        })
        .then(unwrap);

      if (res.success) {
        let parsedBody = res.data.body;
        try {
          parsedBody = JSON.parse(res.data.body);
        } catch {
          // keep string
        }

        const successResponse = {
          statusCode: res.data.statusCode,
          headers: res.data.headers,
          body: parsedBody,
          elapsedMs: res.data.elapsedMs,
        };

        setResponse(successResponse);
        setLastResponse(parsedBody);

        setHistory([
          {
            id: Math.random().toString(36).substring(2, 9),
            method,
            url,
            headers: headersMap,
            body: draft.bodyText,
            timestamp: Date.now(),
          },
          ...history.slice(0, 49),
        ]);

        recordAutocomplete(
          {
            ...draft,
            paramValues,
          },
          {
            responseBody: parsedBody,
            responseHeaders: res.data.headers,
          },
        );
      } else {
        setResponseError(res.message || "Failed to receive a valid response");
      }
    } catch (err: unknown) {
      setResponseError(err instanceof Error ? err.message : "Request execution encountered an exception");
    } finally {
      setLoading(false);
    }
  };

  const ms = methodStyle(method);
  const responseViewerLabels = buildApiResponseViewerLabels(t);

  const buildCopyInput = useCallback(() => {
    if (!response) {
      return null;
    }
    return {
      method,
      url,
      requestHeaders: headersToRecord(draft.headers),
      requestBody: draft.bodyText.trim() || null,
      response: {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        elapsedMs: response.elapsedMs,
      },
    };
  }, [draft.bodyText, draft.headers, method, response, url]);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`flex flex-col space-y-6 w-full ${isEmbedded ? "h-full min-h-0" : ""}`}>
      {!isEmbedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Code className="text-primary w-6 h-6" /> {t.title}
            </h1>
            <p className="text-sm text-base-content/70 mt-1">{t.subtitle}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
        <div className="xl:col-span-1 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col h-[650px]">
          <div className="flex items-center justify-between border-b border-base-200 pb-3 mb-3">
            <span className="font-semibold flex items-center gap-1.5 text-base-content/80">
              <HistoryIcon className="w-4 h-4" /> {t.history}
            </span>
            {history.length > 0 && (
              <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => setHistory([])}>
                {t.clearHistory}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {history.length === 0 ? (
              <div className="text-center py-10 text-xs text-base-content/40 italic">{t.noHistory}</div>
            ) : (
              history.map((item) => {
                const itemStyle = methodStyle(item.method);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadHistoryItem(item)}
                    className="w-full text-left p-2 border border-base-200 hover:border-primary/40 hover:bg-base-200/50 rounded-lg cursor-pointer transition-all duration-200 text-xs flex flex-col space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant={{ color: itemStyle.color, size: "sm" }}
                        className="font-black font-mono px-1.5 py-1"
                      >
                        {item.method}
                      </Badge>
                      <span className="text-[10px] text-base-content/50">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="truncate font-mono text-base-content/70 text-[11px]">{item.url}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="xl:col-span-3 space-y-3">
          <ApiRequestForm
            draft={draft}
            onChange={updateDraft}
            suggestions={suggestions}
            method={method}
            labels={{ origin: t.origin, pathname: t.pathname }}
            config={CLIENT_FIELD_CONFIG}
            className="space-y-3"
          >
            <div className={`rounded-xl border p-4 shadow-sm ${ms.bg}`}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <select
                  className="select select-bordered select-sm font-black uppercase tracking-tight bg-base-100 min-w-[92px]"
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>

              <ApiRequestForm.Header
                method={method}
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
                      variant="primary"
                      size="sm"
                      className="gap-2 shrink-0 flex items-center font-bold tracking-tight shadow-lg shadow-primary/20"
                      disabled={loading || !url}
                      onClick={handleSend}
                      type="button"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      {loading ? t.sending : t.send}
                    </Button>
                  </>
                }
              />
            </div>

            <ApiRequestForm.QueryParams
              title={t.queryParams}
              labels={{
                add: t.addQueryParam,
                key: t.paramKey,
                value: t.paramValue,
              }}
            />

            <ApiRequestForm.WhenMethod methods={METHODS_WITH_BODY}>
              <ApiRequestForm.Body title={t.body} />
            </ApiRequestForm.WhenMethod>

            <ApiRequestForm.Headers
              title={t.customHeaders}
              labels={{
                addHeader: t.addHeader,
                key: t.headerKey,
                value: t.headerValue,
              }}
            />
          </ApiRequestForm>

          <ApiResponseViewer
            loading={loading}
            response={response}
            error={responseError}
            t={responseViewerLabels}
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
      </div>
    </div>
  );
}
