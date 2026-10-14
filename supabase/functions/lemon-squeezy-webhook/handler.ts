// Lemon Squeezy subscription webhook handling.
//
// Verifies the webhook signature, records the raw body in `webhook_events`
// (sha256 hex id) so a replay returns 200 without reprocessing, then updates
// `workspaces.status` / `workspaces.seat_limit` from `subscription_*` events,
// matched via `meta.custom_data.workspace_id`. If processing after the insert
// fails, the event row is deleted so a retry is processed again.

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
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: WebhookQueryError | null }>;
    };
  };
}

export interface WebhookHandlerDeps {
  supabase: WebhookSupabase;
  webhookSecret: string;
}

// Map Lemon Squeezy subscription `status` -> our `workspaces.status`.
const STATUS_MAP: Record<string, "active" | "past_due" | "canceled"> = {
  active: "active",
  on_trial: "active",
  paused: "past_due",
  past_due: "past_due",
  unpaid: "past_due",
  cancelled: "canceled",
  expired: "canceled",
};

// Optional: map Lemon Squeezy `variant_id` -> seat_limit for that plan.
// Fill in your real variant IDs once the products are created in Lemon Squeezy.
export const SEAT_LIMIT_BY_VARIANT: Record<string, number> = {
  // Horizon Gateway Team Pro — Monthly · 5 seats ($15)
  "1987632": 5,
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifySignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): Promise<boolean> {
  const signature = signatureHeader?.trim().toLowerCase() ?? "";
  if (!signature || !webhookSecret) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return timingSafeEqual(toHex(computed), signature);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

async function releaseWebhookEvent(supabase: WebhookSupabase, eventId: string): Promise<void> {
  try {
    const { error } = await supabase.from("webhook_events").delete().eq("id", eventId);
    if (error) {
      console.error("webhook_events delete failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("webhook_events delete failed:", message);
  }
}

interface LemonSqueezyPayload {
  meta?: {
    event_name?: string;
    custom_data?: { workspace_id?: string };
  };
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      variant_id?: number | string;
    };
  };
}

export async function handleLemonSqueezyWebhook(req: Request, deps: WebhookHandlerDeps): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");

  if (!(await verifySignature(rawBody, signature, deps.webhookSecret))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: LemonSqueezyPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }

  const eventName = payload.meta?.event_name ?? "";
  const eventId = await sha256Hex(rawBody);
  const { error: insertError } = await deps.supabase
    .from("webhook_events")
    .insert({ id: eventId, event_name: eventName });
  if (insertError) {
    if (insertError.code === "23505") {
      return new Response("duplicate", { status: 200 });
    }
    console.error("webhook_events insert failed:", insertError.message);
    return new Response("insert failed", { status: 500 });
  }

  try {
    if (!eventName.startsWith("subscription_")) {
      return new Response(`ignored event: ${eventName}`, { status: 200 });
    }

    const workspaceId = payload.meta?.custom_data?.workspace_id;
    if (!workspaceId) {
      console.warn("lemon-squeezy webhook missing meta.custom_data.workspace_id", eventName);
      return new Response("missing workspace_id in custom_data", { status: 200 });
    }

    const attributes = payload.data?.attributes ?? {};
    const status = STATUS_MAP[attributes.status ?? ""] ?? "active";
    const variantId = attributes.variant_id != null ? String(attributes.variant_id) : null;
    const seatLimit = variantId ? SEAT_LIMIT_BY_VARIANT[variantId] : undefined;
    const subscriptionId = payload.data?.id != null ? String(payload.data.id) : null;

    const isCanceled = status === "canceled";
    const updates: Record<string, unknown> = {
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

    const { error } = await deps.supabase.from("workspaces").update(updates).eq("id", workspaceId);
    if (error) {
      console.error("workspaces update failed:", error.message);
      await releaseWebhookEvent(deps.supabase, eventId);
      return new Response("update failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("webhook processing failed:", message);
    await releaseWebhookEvent(deps.supabase, eventId);
    return new Response("processing failed", { status: 500 });
  }
}
