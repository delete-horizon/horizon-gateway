import { supabase } from "@/shared/api/supabase";
import { logClientFailure } from "@/shared/lib/appLog";
import {
  buildLocalDevCheckoutUrl,
  isBoundCheckoutUrl,
} from "../../../../supabase/functions/_shared/checkoutRequest.ts";
import { isRecord } from "../../../../supabase/functions/_shared/guards.ts";

/**
 * Lemon Squeezy paid checkout. Off in production (`!DEV`) unless explicitly enabled.
 *
 * - Local / `tauri dev`: on by default.
 * - Tauri release / production website: off.
 * - Re-enable a production build with `VITE_ENABLE_PAID_CHECKOUT=true`.
 * - Force off even in dev with `VITE_ENABLE_PAID_CHECKOUT=false`.
 */
export function isPaidCheckoutEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_PAID_CHECKOUT;
  if (flag === "true" || flag === "1") {
    return true;
  }
  if (flag === "false" || flag === "0") {
    return false;
  }
  return import.meta.env.DEV;
}

/** Local stack only. Hosted checkout must come from the create-checkout function. */
export function localDevCheckoutUrl(base: string, workspaceId: string): string | null {
  return buildLocalDevCheckoutUrl(base, workspaceId);
}

const CHECKOUT_ERROR_REASONS: Record<string, string> = {
  unauthorized: "unauthorized",
  forbidden: "not_admin",
  "too many requests": "rate_limited",
  "invalid request": "invalid_request",
  "method not allowed": "invalid_request",
  "checkout is unavailable": "unavailable",
};

/** Map a known checkout error string. Unknown text is dropped so it cannot leak into the log. */
export function reasonFromCheckoutError(message: string): string | null {
  return CHECKOUT_ERROR_REASONS[message.trim().toLowerCase()] ?? null;
}

export function reasonFromHttpStatus(status: number): string {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "not_admin";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 400 || status === 405) {
    return "invalid_request";
  }
  if (status >= 500) {
    return "unavailable";
  }
  return "invoke_error";
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

function statusFromInvokeError(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const context = error.context;
  if (isResponse(context)) {
    return context.status;
  }
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

async function checkoutErrorMessage(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !isResponse(error.context)) {
    return null;
  }
  try {
    const body: unknown = await error.context.clone().json();
    if (!isRecord(body) || typeof body.error !== "string") {
      return null;
    }
    return reasonFromCheckoutError(body.error) ? body.error : null;
  } catch {
    return null;
  }
}

/** Reason code and HTTP status for a create-checkout invoke error. The raw body is not returned. */
export async function describeCheckoutFailure(error: unknown): Promise<{ reason: string; status: number | null }> {
  const status = statusFromInvokeError(error);
  const message = await checkoutErrorMessage(error);
  const mapped = message ? reasonFromCheckoutError(message) : null;
  if (mapped) {
    return { reason: mapped, status };
  }
  if (status != null) {
    return { reason: reasonFromHttpStatus(status), status };
  }
  return { reason: "invoke_error", status: null };
}

/** Accept a function payload only when it is an HTTPS Lemon URL bound to this workspace. */
export function checkoutUrlFromFunctionPayload(payload: unknown, workspaceId: string): string | null {
  if (!isRecord(payload) || typeof payload.url !== "string") {
    return null;
  }
  return isBoundCheckoutUrl(payload.url, workspaceId) ? payload.url : null;
}

/** Hosted checkout. Returns null when the function rejects the caller or the URL is not bound. */
export async function fetchHostedCheckoutUrl(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { workspace_id: workspaceId },
  });
  if (error) {
    const failure = await describeCheckoutFailure(error);
    await logClientFailure({
      function: "create-checkout",
      reason: failure.reason,
      status: failure.status,
      workspaceId,
    });
    return null;
  }
  const url = checkoutUrlFromFunctionPayload(data, workspaceId);
  if (!url) {
    await logClientFailure({
      function: "create-checkout",
      reason: "unbound_url",
      status: null,
      workspaceId,
    });
  }
  return url;
}
