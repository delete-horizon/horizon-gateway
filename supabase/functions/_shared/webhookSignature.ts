export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare of two SHA-256 hex digests. Rejects any other shape. */
export function timingSafeEqualHex(expectedHex: string, providedHex: string): boolean {
  const expected = expectedHex.trim().toLowerCase();
  const provided = providedHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected) || !/^[0-9a-f]{64}$/.test(provided)) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < 64; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return toHex(digest);
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(digest);
}

export async function verifyHmacSha256(secret: string, payload: string, providedHex: string): Promise<boolean> {
  if (!secret) {
    return false;
  }
  const computed = await hmacSha256Hex(secret, payload);
  return timingSafeEqualHex(computed, providedHex);
}
