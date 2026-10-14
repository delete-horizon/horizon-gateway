import { supabase } from "@/shared/api/supabase";
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
    console.error("create-checkout failed");
    return null;
  }
  return checkoutUrlFromFunctionPayload(data, workspaceId);
}
