import { isCheckoutEmail, isUuid } from "./guards.ts";
import { hmacSha256Hex, verifyHmacSha256 } from "./webhookSignature.ts";

export { isCheckoutEmail, isUuid };

const MAX_CHECKOUT_URL_LENGTH = 2048;

export function isLemonHost(hostname: string): boolean {
  return hostname === "lemonsqueezy.com" || hostname.endsWith(".lemonsqueezy.com");
}

export function isLemonCheckoutUrl(value: string): boolean {
  if (value.length > MAX_CHECKOUT_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isLemonHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Lemon reads `checkout[custom][*]` keys literally. URLSearchParams encodes
 * brackets, so the query string is appended by hand.
 */
export function appendCheckoutParams(base: string, params: Record<string, string>): string | null {
  if (!isLemonCheckoutUrl(base)) {
    return null;
  }
  const url = new URL(base);
  const extra = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const joiner = url.search ? "&" : "?";
  const built = `${url.toString()}${joiner}${extra}`;
  return built.length <= MAX_CHECKOUT_URL_LENGTH ? built : null;
}

export async function signWorkspaceId(secret: string, workspaceId: string): Promise<string | null> {
  if (!secret || !isUuid(workspaceId)) {
    return null;
  }
  return hmacSha256Hex(secret, workspaceId);
}

export async function verifyWorkspaceBinding(
  secret: string,
  workspaceId: unknown,
  workspaceSig: unknown,
): Promise<boolean> {
  if (!isUuid(workspaceId) || typeof workspaceSig !== "string") {
    return false;
  }
  return verifyHmacSha256(secret, workspaceId, workspaceSig);
}

export function isBoundCheckoutUrl(value: string, workspaceId: string): boolean {
  if (!isUuid(workspaceId) || !isLemonCheckoutUrl(value)) {
    return false;
  }
  const url = new URL(value);
  const sig = url.searchParams.get("checkout[custom][workspace_sig]") ?? "";
  return url.searchParams.get("checkout[custom][workspace_id]") === workspaceId && /^[0-9a-f]{64}$/.test(sig);
}

/** Local dev only. The hosted webhook rejects checkout URLs that have no binding signature. */
export function buildLocalDevCheckoutUrl(base: string, workspaceId: string): string | null {
  if (!isUuid(workspaceId)) {
    return null;
  }
  return appendCheckoutParams(base, { "checkout[custom][workspace_id]": workspaceId });
}
