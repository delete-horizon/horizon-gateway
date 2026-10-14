export type WorkspaceBillingStatus = "active" | "past_due" | "canceled";

const STATUS_MAP: Record<string, WorkspaceBillingStatus> = {
  active: "active",
  on_trial: "active",
  paused: "past_due",
  past_due: "past_due",
  unpaid: "past_due",
  cancelled: "canceled",
  expired: "canceled",
};

/** Unknown or missing Lemon statuses do not grant an active plan. */
export function mapLemonSubscriptionStatus(status: unknown): WorkspaceBillingStatus | null {
  if (typeof status !== "string") {
    return null;
  }
  return STATUS_MAP[status] ?? null;
}

export function lemonVariantId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^[0-9]{1,20}$/.test(text)) {
    return null;
  }
  return text;
}

export function lemonSubscriptionId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
    return null;
  }
  return text;
}
