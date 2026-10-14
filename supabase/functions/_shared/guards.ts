export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

export function isCheckoutEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

const GITHUB_ID = /^[0-9]{1,12}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export function githubId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    const asText = String(value);
    return GITHUB_ID.test(asText) ? asText : null;
  }
  if (typeof value !== "string" || !GITHUB_ID.test(value.trim())) {
    return null;
  }
  return value.trim();
}

export function githubLogin(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return GITHUB_LOGIN.test(trimmed) ? trimmed : null;
}
