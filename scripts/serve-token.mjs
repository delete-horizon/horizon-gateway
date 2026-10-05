/**
 * Session token for the serve IPC (written by horizon-gateway-serve on start).
 * Sent as `token` on every command and as the first line on the event stream.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_ID = "com.lurain.horizon-gateway";

function platformDataDir() {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}

export function readServeToken() {
  try {
    return readFileSync(join(platformDataDir(), APP_ID, "serve.token"), "utf8").trim();
  } catch {
    return undefined;
  }
}

/** First line a client writes on the event port. */
export function eventHello() {
  return `${JSON.stringify({ token: readServeToken() ?? "" })}\n`;
}
