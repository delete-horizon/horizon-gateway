import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { languageAtom } from "@/entities/app";
import { fetchApiLogById } from "@/entities/domain-api-logging";
import { ApiLogExchangeDetail, buildApiResponseViewerLabels } from "@/entities/sandbox";
import type { ApiLogEntry } from "@/shared/api";
import { LoadingScreen } from "@/shared/ui/loader/LoadingScreen";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import { HandoffMenu } from "./HandoffMenu";
import { Panel } from "./Panel";

interface DomainApiLogDetailPanelProps {
  logId: string;
  domainId: number;
  hostFilter?: string;
  onClose: () => void;
}

export function DomainApiLogDetailPanel({ logId, domainId, hostFilter, onClose }: DomainApiLogDetailPanelProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [log, setLog] = useState<ApiLogEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const labels = useMemo(
    () => ({
      request: t.apiLogRequest,
      requestBody: t.apiLogRequestBody,
      requestHeaders: t.apiLogRequestHeaders,
      responseBody: t.apiLogResponseBody,
      responseHeaders: t.apiLogResponseHeaders,
      status: t.apiLogStatus,
      time: t.apiLogTime,
      empty: t.apiLogEmpty,
      copy: t.apiLogCopy,
      copied: t.apiLogCopied,
      btnCopy: t.apiLogBtnCopy,
      copyHtml: t.apiLogCopyHtml,
      copyMarkdown: t.apiLogCopyMarkdown,
    }),
    [t],
  );

  const responseViewerProps = useMemo(
    () => ({
      t: buildApiResponseViewerLabels({
        response: t.apiLogResponse,
        sending: t.apiLogSending,
        responseStatus: t.apiLogStatus,
        responseTime: t.apiLogTime,
        responseBody: t.apiLogResponseBody,
        responseHeaders: t.apiLogResponseHeaders,
        empty: t.apiLogEmpty,
        importSavedSchema: t.apiLogImportSavedSchema,
        validationResult: t.apiLogValidationResult,
        validationDone: t.apiLogValidationDone,
        validationFailedTitle: t.apiLogValidationFailed,
        validationPending: t.apiLogValidationPending,
        awaitingResponse: t.apiLogAwaitingResponse,
      }),
    }),
    [t],
  );

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const found = await fetchApiLogById(logId, hostFilter ?? null);
      setLog(found);
    } catch (e) {
      console.error(e);
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [logId, hostFilter]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  return (
    <Panel id="api/log" title={t.apiLogDetail} subtitle={log?.path} onClose={onClose} width="lg">
      {loading ? (
        <LoadingScreen />
      ) : log ? (
        <ApiLogExchangeDetail
          log={log}
          labels={labels}
          actions={<HandoffMenu log={log} domainId={domainId} />}
          responseViewerProps={responseViewerProps}
        />
      ) : (
        <p className="text-xs text-base-content/50">{t.apiLogNotFound}</p>
      )}
    </Panel>
  );
}
