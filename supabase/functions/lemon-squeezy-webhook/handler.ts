// Lemon Squeezy subscription webhook handling.
//
// Verifies the webhook signature (x-signature HMAC), records the raw body in
// `webhook_events` (sha256 hex id) so a replay returns 200 without reprocessing,
// then updates workspace billing columns. The workspace id is honored when
// `meta.custom_data.workspace_sig` is an HMAC of that id made with the webhook
// secret. A present signature must verify; otherwise the event is ignored (200).
//
// Older app builds opened the plain checkout URL with only
// `checkout[custom][workspace_id]`. Those unsigned subscription events may grant
// the pro plan when the id is a UUID and the current time is before
// LEGACY_UNSIGNED_CUTOFF (2026-11-15T00:00:00Z). Override that instant with the
// LEGACY_UNSIGNED_CUTOFF env var (ISO-8601). The acceptance is logged as
// `legacy_unsigned_checkout` with workspace_id and the event name. Refunds and
// cancellations keep the previous rules. After the cutoff, unsigned payloads
// are ignored. Unknown subscription statuses do not grant an active plan.
// Refund events also record `refund_events` and deactivate the matching license
// key. If processing after the insert fails, the event row is deleted so a
// retry is processed again.
//
// Deploy order: create-checkout, then the app release, then this webhook.
// Refunds do not block purchases. Apply the billing RLS migration and the
// refund_events migration before deploying this function.

import { verifyWorkspaceBinding } from "../_shared/checkoutRequest.ts";
import { isRecord, isUuid } from "../_shared/guards.ts";
import { lemonSubscriptionId, lemonVariantId, mapLemonSubscriptionStatus } from "../_shared/lemonSubscription.ts";
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../_shared/webhookSignature.ts";
import { type LemonPayload, planLemonPayload, REFUND_EVENTS } from "./refund.ts";

export interface WebhookQueryError {
  code?: string;
  message: string;
}

/** Structural slice of the Supabase client this handler actually calls. */
export interface WebhookSupabase {
  from(table: string): {
    insert(values: { id: string; event_name: string }): PromiseLike<{ error: WebhookQueryError | null }>;
    delete(): {
      eq(column: string, value: string): PromiseLike<{ error: WebhookQueryError | null }>;
    };
    update(
      values: Record<string, unknown>,
      options?: { count?: "exact" },
    ): {
      eq(column: string, value: string): PromiseLike<{ error: WebhookQueryError | null; count?: number | null }>;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: WebhookQueryError | null }>;
}

export interface WebhookHandlerDeps {
  supabase: WebhookSupabase;
  webhookSecret: string;
  /**
   * ISO-8601 cutoff. `index.ts` passes `LEGACY_UNSIGNED_CUTOFF` from the
   * environment. When omitted, the constant is used.
   */
  legacyUnsignedCutoff?: string;
}

const MAX_BODY_BYTES = 1_000_000;

/** Unsigned UUID checkouts may grant pro only before this instant. */
export const LEGACY_UNSIGNED_CUTOFF = "2026-11-15T00:00:00Z";

/** Invalid or blank values fall back to {@link LEGACY_UNSIGNED_CUTOFF}. */
export function resolveLegacyUnsignedCutoff(rawValue: string | undefined): number {
  const raw = rawValue?.trim() || LEGACY_UNSIGNED_CUTOFF;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Date.parse(LEGACY_UNSIGNED_CUTOFF) : parsed;
}

function presentWorkspaceSig(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Horizon Gateway Team Pro — Monthly · 5 seats ($15)
export const SEAT_LIMIT_BY_VARIANT: Record<string, number> = {
  "1987632": 5,
};

async function verifySignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): Promise<boolean> {
  const signature = signatureHeader?.trim() ?? "";
  if (!signature || !webhookSecret) {
    return false;
  }
  const computed = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqualHex(computed, signature);
}

async function releaseWebhookEvent(supabase: WebhookSupabase, eventId: string): Promise<void> {
  try {
    const { error } = await supabase.from("webhook_events").delete().eq("id", eventId);
    if (error) {
      console.error("webhook_events delete failed");
    }
  } catch {
    console.error("webhook_events delete failed");
  }
}

interface LemonSqueezyPayload extends LemonPayload {
  data?: LemonPayload["data"] & {
    id?: string;
    attributes?: {
      status?: string;
      variant_id?: number | string;
    };
  };
}

function safeEventName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,80}$/.test(value)) {
    return "unknown";
  }
  return value;
}

const LICENSE_EVENTS = new Set(["license_key_created", "license_key_updated"]);

async function recordRefundAndDeactivate(
  supabase: WebhookSupabase,
  payload: LemonSqueezyPayload,
): Promise<Response | null> {
  const plan = planLemonPayload(payload, new Date().toISOString(), SEAT_LIMIT_BY_VARIANT);
  if (plan.kind !== "refund") {
    return null;
  }
  if (!plan.email) {
    console.warn("lemon-squeezy refund missing buyer email", payload.meta?.event_name ?? "");
  } else {
    const inserted = await supabase.rpc("record_refund_event", {
      p_email: plan.email,
      p_order_id: plan.orderId,
      p_refunded_at: plan.refundedAt,
    });
    if (inserted.error) {
      console.error("refund_events insert failed:", inserted.error.message);
      return new Response("refund insert failed", { status: 500 });
    }
  }

  const deactivated = await supabase.rpc("deactivate_license_for_refund", {
    p_order_id: plan.licenseOrderId,
    p_subscription_id: plan.subscriptionId,
    p_refunded_at: plan.refundedAt,
  });
  if (deactivated.error) {
    console.error("license deactivate failed:", deactivated.error.message);
    return new Response("license deactivate failed", { status: 500 });
  }
  return null;
}

async function upsertLicenseKey(supabase: WebhookSupabase, payload: LemonSqueezyPayload): Promise<Response | null> {
  const plan = planLemonPayload(payload, new Date().toISOString(), SEAT_LIMIT_BY_VARIANT);
  if (plan.kind !== "license") {
    return null;
  }
  const upserted = await supabase.rpc("upsert_license_key", {
    p_lemon_id: plan.lemonId,
    p_license_key: plan.licenseKey,
    p_order_id: plan.orderId,
    p_status: plan.status,
    p_ends_at: plan.endsAt,
  });
  if (upserted.error) {
    console.error("license upsert failed:", upserted.error.message);
    return new Response("license upsert failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

export async function handleLemonSqueezyWebhook(req: Request, deps: WebhookHandlerDeps): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const signature = req.headers.get("x-signature");
  if (!(await verifySignature(rawBody, signature, deps.webhookSecret))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  if (!isRecord(payload)) {
    return new Response("invalid JSON", { status: 400 });
  }

  const meta = isRecord(payload.meta) ? payload.meta : {};
  const eventName = safeEventName(meta.event_name);
  const eventId = await sha256Hex(rawBody);
  const { error: insertError } = await deps.supabase
    .from("webhook_events")
    .insert({ id: eventId, event_name: eventName });
  if (insertError) {
    if (insertError.code === "23505") {
      return new Response("duplicate", { status: 200 });
    }
    console.error("webhook_events insert failed");
    return new Response("insert failed", { status: 500 });
  }

  try {
    if (REFUND_EVENTS.has(eventName)) {
      const refundFailure = await recordRefundAndDeactivate(deps.supabase, payload as LemonSqueezyPayload);
      if (refundFailure) {
        await releaseWebhookEvent(deps.supabase, eventId);
        return refundFailure;
      }
      if (eventName === "order_refunded") {
        return new Response("ok", { status: 200 });
      }
    }

    if (!eventName.startsWith("subscription_")) {
      if (LICENSE_EVENTS.has(eventName)) {
        const licenseResponse = await upsertLicenseKey(deps.supabase, payload as LemonSqueezyPayload);
        if (licenseResponse) {
          if (licenseResponse.status === 500) {
            await releaseWebhookEvent(deps.supabase, eventId);
          }
          return licenseResponse;
        }
      }
      return new Response("ignored", { status: 200 });
    }

    const custom = isRecord(meta.custom_data) ? meta.custom_data : {};
    const workspaceId = custom.workspace_id;
    const workspaceSig = custom.workspace_sig;
    const cutoffMs = resolveLegacyUnsignedCutoff(deps.legacyUnsignedCutoff);
    // A present workspace_sig must verify. Unsigned checkouts are a temporary
    // upgrade path only: refunds and cancellations stay on the previous rules.
    let boundWorkspaceId: string;
    let legacyUnsigned = false;
    if (presentWorkspaceSig(workspaceSig)) {
      const bound = await verifyWorkspaceBinding(deps.webhookSecret, workspaceId, workspaceSig);
      if (!bound || typeof workspaceId !== "string") {
        console.warn("lemon webhook rejected workspace binding");
        return new Response("ignored", { status: 200 });
      }
      boundWorkspaceId = workspaceId;
    } else if (Date.now() < cutoffMs && isUuid(workspaceId) && !REFUND_EVENTS.has(eventName)) {
      boundWorkspaceId = workspaceId;
      legacyUnsigned = true;
    } else {
      console.warn("lemon webhook rejected workspace binding");
      return new Response("ignored", { status: 200 });
    }

    const data = isRecord(payload.data) ? payload.data : {};
    const attributes = isRecord(data.attributes) ? data.attributes : {};
    const status = mapLemonSubscriptionStatus(attributes.status);
    if (!status) {
      console.warn("lemon webhook ignored unknown subscription status");
      return new Response("ignored", { status: 200 });
    }
    if (legacyUnsigned && status === "canceled") {
      console.warn("lemon webhook rejected workspace binding");
      return new Response("ignored", { status: 200 });
    }
    if (legacyUnsigned) {
      console.warn(
        JSON.stringify({
          msg: "legacy_unsigned_checkout",
          workspace_id: boundWorkspaceId,
          event_name: eventName,
        }),
      );
    }

    const variantId = lemonVariantId(attributes.variant_id);
    const seatLimit = variantId ? SEAT_LIMIT_BY_VARIANT[variantId] : undefined;
    const subscriptionId = lemonSubscriptionId(data.id);
    const isCanceled = status === "canceled";
    const updates: Record<string, string | number | null> = {
      status,
      plan: isCanceled ? "free" : "pro",
    };
    if (seatLimit != null && !isCanceled) {
      updates.seat_limit = seatLimit;
    }
    if (isCanceled) {
      updates.seat_limit = 3;
    }
    if (subscriptionId) {
      updates.ls_subscription_id = isCanceled ? null : subscriptionId;
    }

    const { error, count } = await deps.supabase
      .from("workspaces")
      .update(updates, { count: "exact" })
      .eq("id", boundWorkspaceId);
    if (error || count === 0) {
      console.error("workspaces update failed");
      await releaseWebhookEvent(deps.supabase, eventId);
      return new Response("update failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch {
    console.error("webhook processing failed");
    await releaseWebhookEvent(deps.supabase, eventId);
    return new Response("processing failed", { status: 500 });
  }
}
