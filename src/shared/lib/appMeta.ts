/** Kept in sync with `package.json` `version`. Update via `pnpm version:*` scripts. */
export const APP_VERSION = "2.8.6";

/**
 * Short, coarse OS label safe for feedback/telemetry metadata.
 * Never returns full `navigator.userAgent` (may contain identifying details).
 */
export function getOsLabel(): string {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";

  if (/win/i.test(platform) || /windows/i.test(ua)) {
    return "windows";
  }
  if (/mac/i.test(platform) || /macintosh/i.test(ua)) {
    return "macos";
  }
  if (/linux/i.test(platform) || /linux/i.test(ua)) {
    return "linux";
  }
  return "unknown";
}
