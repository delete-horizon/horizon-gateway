// Pure Lemon Squeezy payload planning. No Deno or Supabase imports so tests can load it.

export const REFUND_EVENTS = new Set(["order_refunded", "subscription_payment_refunded"]);

export const SUBSCRIPTION_LIFECYCLE_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_expired",
  "subscription_resumed",
  "subscription_paused",
  "subscription_unpaused",
]);

const LICENSE_EVENTS = new Set(["license_key_created", "license_key_updated"]);

export const STATUS_MAP: Record<string, "active" | "past_due" | "canceled"> = {
  active: "active",
  on_trial: "active",
  paused: "past_due",
  past_due: "past_due",
  unpaid: "past_due",
  cancelled: "canceled",
  expired: "canceled",
};

export interface LemonAttributes {
  status?: string;
  variant_id?: number | string;
  user_email?: string;
  refunded_at?: string | null;
  order_id?: number | string | null;
  subscription_id?: number | string | null;
  key?: string;
  disabled?: boolean;
  expires_at?: string | null;
}

export interface LemonPayload {
  meta?: {
    event_name?: string;
    custom_data?: { workspace_id?: string };
  };
  data?: {
    id?: string | number;
    attributes?: LemonAttributes;
  };
}

export interface WorkspaceUpdate {
  status: "active" | "past_due" | "canceled";
  plan: "free" | "pro";
  seat_limit?: number;
  ls_subscription_id?: string | null;
}

export interface RefundPlan {
  kind: "refund";
  email: string | null;
  /** Stored in refund_events.order_id. One row per order, or per subscription invoice. */
  orderId: string;
  /** Lemon order id used to find license_keys. Null when the payload has no order id. */
  licenseOrderId: string | null;
  subscriptionId: string | null;
  refundedAt: string;
}

export interface SubscriptionPlan {
  kind: "subscription";
  workspaceId: string | null;
  updates: WorkspaceUpdate | null;
  orderId: string | null;
  subscriptionId: string | null;
}

export interface LicensePlan {
  kind: "license";
  lemonId: string;
  licenseKey: string;
  orderId: string | null;
  status: "active" | "disabled";
  endsAt: string | null;
}

export interface IgnorePlan {
  kind: "ignore";
  reason: string;
}

export type LemonPlan = RefundPlan | SubscriptionPlan | LicensePlan | IgnorePlan;

export function normalizeBuyerEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    return null;
  }
  return email;
}

export function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/** Keep the earlier end so a later refund webhook cannot extend retention. */
export function earlierEndsAt(current: string | null, refundedAt: string): string {
  if (!current) {
    return refundedAt;
  }
  const currentMs = Date.parse(current);
  const refundedMs = Date.parse(refundedAt);
  if (Number.isNaN(currentMs) || Number.isNaN(refundedMs)) {
    return current < refundedAt ? current : refundedAt;
  }
  return currentMs <= refundedMs ? current : refundedAt;
}

export function licenseStatus(attributes: LemonAttributes): "active" | "disabled" {
  if (attributes.disabled === true) {
    return "disabled";
  }
  const status = (attributes.status ?? "").toLowerCase();
  if (status === "disabled" || status === "expired") {
    return "disabled";
  }
  return "active";
}

function refundedAtFrom(attributes: LemonAttributes, nowIso: string): string {
  if (typeof attributes.refunded_at === "string" && attributes.refunded_at.trim().length > 0) {
    const parsed = Date.parse(attributes.refunded_at);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return nowIso;
}

export function planLemonPayload(
  payload: LemonPayload,
  nowIso: string,
  seatLimitByVariant: Record<string, number>,
): LemonPlan {
  const eventName = payload.meta?.event_name ?? "";
  const attributes = payload.data?.attributes ?? {};
  const dataId = asId(payload.data?.id);

  if (REFUND_EVENTS.has(eventName)) {
    const isOrderRefund = eventName === "order_refunded";
    const subscriptionId = isOrderRefund ? null : asId(attributes.subscription_id);
    const licenseOrderId = isOrderRefund ? dataId : asId(attributes.order_id);
    let orderId = isOrderRefund ? dataId : null;
    if (!isOrderRefund && dataId) {
      orderId = `invoice:${dataId}`;
    }
    if (!orderId) {
      orderId = licenseOrderId;
    }
    if (!orderId) {
      return { kind: "ignore", reason: "refund missing order id" };
    }
    return {
      kind: "refund",
      email: normalizeBuyerEmail(attributes.user_email),
      orderId,
      licenseOrderId,
      subscriptionId,
      refundedAt: refundedAtFrom(attributes, nowIso),
    };
  }

  if (LICENSE_EVENTS.has(eventName)) {
    const lemonId = dataId;
    const licenseKey = typeof attributes.key === "string" ? attributes.key.trim() : "";
    if (!lemonId || !licenseKey) {
      return { kind: "ignore", reason: "license event missing id or key" };
    }
    const status = licenseStatus(attributes);
    const expiresAt = typeof attributes.expires_at === "string" && attributes.expires_at.trim().length > 0
      ? attributes.expires_at
      : null;
    return {
      kind: "license",
      lemonId,
      licenseKey,
      orderId: asId(attributes.order_id),
      status,
      endsAt: status === "disabled" ? earlierEndsAt(expiresAt, nowIso) : expiresAt,
    };
  }

  if (!SUBSCRIPTION_LIFECYCLE_EVENTS.has(eventName)) {
    return { kind: "ignore", reason: `ignored event: ${eventName}` };
  }

  const workspaceId = payload.meta?.custom_data?.workspace_id?.trim() || null;
  if (!workspaceId) {
    return {
      kind: "subscription",
      workspaceId: null,
      updates: null,
      orderId: asId(attributes.order_id),
      subscriptionId: dataId,
    };
  }

  const status = STATUS_MAP[attributes.status ?? ""] ?? "active";
  const variantId = attributes.variant_id != null ? String(attributes.variant_id) : null;
  const seatLimit = variantId ? seatLimitByVariant[variantId] : undefined;
  const subscriptionId = dataId;
  const isCanceled = status === "canceled";
  const updates: WorkspaceUpdate = {
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

  return {
    kind: "subscription",
    workspaceId,
    updates,
    orderId: asId(attributes.order_id),
    subscriptionId,
  };
}
