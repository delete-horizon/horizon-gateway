import { AlertTriangle, CheckCircle } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Badge } from "@/shared/ui/badge/badge";
import { Card } from "@/shared/ui/card/card";
import { ApiHttpMessageViewer, type ApiHttpMessageViewerTab } from "./ApiHttpMessageViewer";

export interface ApiResponseViewerProps {
  loading: boolean;
  response: {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    elapsedMs?: number | null;
  } | null;
  error: string | null;
  t: {
    response: string;
    sending: string;
    responseStatus: string;
    responseTime: string;
    responseBody: string;
    responseHeaders: string;
    validateSchema?: string;
    schemaText?: string;
    schemaPassed?: string;
    schemaFailed?: string;
    empty?: string;
    importSavedSchema?: string;
    validationResult?: string;
    validationDone?: string;
    validationFailedTitle?: string;
    validationPending?: string;
    awaitingResponse?: string;
    [key: string]: unknown;
  };
  showSchemaTab?: boolean;
  enableSchemaValidation?: boolean;
  onToggleSchemaValidation?: (enabled: boolean) => void;
  schemaText?: string;
  onChangeSchemaText?: (text: string) => void;
  schemaValidationResult?: { valid: boolean; errors: string | null } | null;
  savedJsonSchemas?: Array<{ id: string; name: string; schemaText: string }>;
  heightClass?: string;
  bodyPanelHeightClass?: string;
  hideOnEmpty?: boolean;
  schemaReadOnly?: boolean;
  showMetaBar?: boolean;
  enableCopy?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
}

function getStatusColor(code: number): "green" | "blue" | "amber" | "red" | "slate" {
  if (code <= 0) {
    return "slate";
  }
  if (code >= 200 && code < 300) {
    return "green";
  }
  if (code >= 300 && code < 400) {
    return "blue";
  }
  if (code >= 400 && code < 500) {
    return "amber";
  }
  return "red";
}

export function ApiResponseViewer({
  loading,
  response,
  error,
  t,
  showSchemaTab = false,
  enableSchemaValidation = false,
  onToggleSchemaValidation,
  schemaText = "",
  onChangeSchemaText,
  schemaValidationResult = null,
  savedJsonSchemas = [],
  heightClass = "min-h-[560px]",
  bodyPanelHeightClass = "min-h-[420px] max-h-[75vh]",
  hideOnEmpty = false,
  schemaReadOnly = false,
  showMetaBar = true,
  enableCopy,
  copyLabel,
  copiedLabel,
}: ApiResponseViewerProps) {
  const schemaTab = useMemo<ApiHttpMessageViewerTab | null>(() => {
    if (!showSchemaTab) {
      return null;
    }

    return {
      id: "schema",
      label: t.validateSchema || "Validate Schema",
      panel: (
        <div className="space-y-4 text-xs">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-xs"
              checked={enableSchemaValidation}
              onChange={(event) => onToggleSchemaValidation?.(event.target.checked)}
              id="enable-schema"
            />
            <label htmlFor="enable-schema" className="font-semibold cursor-pointer">
              {t.validateSchema || "Validate Schema"}
            </label>
          </div>

          {enableSchemaValidation && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center gap-2">
                  <label className="text-[10px] font-bold text-base-content/50 uppercase">
                    {t.schemaText || "Schema JSON"}
                  </label>
                  {!schemaReadOnly && onChangeSchemaText && (
                    <select
                      className="select select-bordered select-xs text-[11px] font-bold py-0 h-6 min-h-6 max-w-[200px]"
                      value=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value && onChangeSchemaText) {
                          onChangeSchemaText(value);
                        }
                      }}
                    >
                      <option value="">{t.importSavedSchema || "Import a saved schema"}</option>
                      {savedJsonSchemas.map((schema) => (
                        <option key={schema.id} value={schema.schemaText}>
                          {schema.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  rows={10}
                  className={`w-full rounded-lg border border-base-300 bg-base-100 font-mono text-[11px] p-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none min-h-[180px] max-h-[28vh] overflow-y-auto ${
                    schemaReadOnly || !onChangeSchemaText ? "bg-base-200/50 cursor-default" : ""
                  }`}
                  value={schemaText}
                  onChange={(event) => onChangeSchemaText?.(event.target.value)}
                  readOnly={schemaReadOnly || !onChangeSchemaText}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-base-content/50 uppercase">
                  {t.validationResult || "Validation result"}
                </span>
                {schemaValidationResult ? (
                  schemaValidationResult.valid ? (
                    <div className="p-3 bg-success/15 border border-success/30 rounded-lg text-success flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 shrink-0" />
                      <div>
                        <h4 className="font-semibold">{t.validationDone || "Validation passed"}</h4>
                        <p className="text-[11px] mt-0.5">{t.schemaPassed || "Passed!"}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-error/15 border border-error/30 rounded-lg text-error flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <div>
                        <h4 className="font-semibold">{t.validationFailedTitle || "Validation failed"}</h4>
                        <p className="text-[11px] mt-0.5 whitespace-pre-wrap">
                          {(t.schemaFailed || "Failed: ") + schemaValidationResult.errors}
                        </p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-6 text-base-content/40 italic">
                    {t.validationPending || "Waiting for validation..."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ),
    };
  }, [
    enableSchemaValidation,
    onChangeSchemaText,
    onToggleSchemaValidation,
    savedJsonSchemas,
    schemaReadOnly,
    schemaText,
    schemaValidationResult,
    showSchemaTab,
    t.importSavedSchema,
    t.schemaFailed,
    t.schemaPassed,
    t.schemaText,
    t.validateSchema,
    t.validationDone,
    t.validationFailedTitle,
    t.validationPending,
    t.validationResult,
  ]);

  if (hideOnEmpty && !response && !loading && !error) {
    return null;
  }

  if (loading) {
    return (
      <section className={`space-y-2 min-w-0 flex flex-col ${heightClass}`}>
        <h2 className="text-sm font-semibold text-base-content">{t.response}</h2>
        <Card className="p-5 flex flex-col flex-1 min-h-0">
          <div className="flex-1 flex flex-col items-center justify-center space-y-3 min-h-[240px]">
            <span className="loading loading-spinner loading-md text-primary" />
            <span className="text-xs text-base-content/60">{t.sending}</span>
          </div>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`space-y-2 min-w-0 flex flex-col ${heightClass}`}>
        <h2 className="text-sm font-semibold text-base-content">{t.response}</h2>
        <Card className="p-5 flex flex-col flex-1 min-h-0 items-center justify-center text-error bg-error/5 min-h-[240px] space-y-2">
          <AlertTriangle className="w-8 h-8" />
          <span className="text-sm font-semibold">{error}</span>
        </Card>
      </section>
    );
  }

  if (!response) {
    return (
      <section className={`space-y-2 min-w-0 flex flex-col ${heightClass}`}>
        <h2 className="text-sm font-semibold text-base-content">{t.response}</h2>
        <Card className="p-5 flex flex-col flex-1 min-h-0">
          <div className="flex-1 flex items-center justify-center text-base-content/40 italic text-sm min-h-[240px]">
            {t.awaitingResponse || "Send a request to see the response here."}
          </div>
        </Card>
      </section>
    );
  }

  const metaBar: ReactNode = showMetaBar ? (
    <div className="flex items-center gap-4 px-4 pt-3 text-xs shrink-0">
      <span className="flex items-center gap-1.5 font-medium">
        {t.responseStatus}:
        <Badge variant={{ color: getStatusColor(response.statusCode), size: "sm" }} className="font-black tabular-nums">
          {response.statusCode > 0 ? response.statusCode : "-"}
        </Badge>
      </span>
      <span className="text-base-content/50">|</span>
      <span className="flex items-center gap-1">
        {t.responseTime}:{" "}
        <strong className="text-primary">
          {response.elapsedMs !== undefined && response.elapsedMs !== null ? `${response.elapsedMs} ms` : "N/A"}
        </strong>
      </span>
    </div>
  ) : undefined;

  return (
    <ApiHttpMessageViewer
      title={t.response}
      headers={response.headers}
      body={response.body}
      labels={{
        body: t.responseBody,
        headers: t.responseHeaders,
        empty: t.empty,
      }}
      metaBar={metaBar}
      additionalTabs={schemaTab ? [schemaTab] : []}
      heightClass={heightClass}
      bodyPanelHeightClass={bodyPanelHeightClass}
      bodyTextClassName="text-success"
      enableCopy={enableCopy}
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
    />
  );
}
