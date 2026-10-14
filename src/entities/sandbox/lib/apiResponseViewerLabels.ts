/** ApiResponseViewer에 넘길 공통 번역 객체 */
export function buildApiResponseViewerLabels(t: {
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
}) {
  return {
    response: t.response,
    sending: t.sending,
    responseStatus: t.responseStatus,
    responseTime: t.responseTime,
    responseBody: t.responseBody,
    responseHeaders: t.responseHeaders,
    validateSchema: t.validateSchema,
    schemaText: t.schemaText,
    schemaPassed: t.schemaPassed,
    schemaFailed: t.schemaFailed,
    empty: t.empty,
    importSavedSchema: t.importSavedSchema,
    validationResult: t.validationResult,
    validationDone: t.validationDone,
    validationFailedTitle: t.validationFailedTitle,
    validationPending: t.validationPending,
    awaitingResponse: t.awaitingResponse,
  };
}
