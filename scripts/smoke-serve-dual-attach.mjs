/**
 * Step 0 smoke: dual client attach to shared horizon-gateway-serve.
 *
 * Prerequisites: serve already listening on 127.0.0.1:17345 (IPC) and :17346 (events).
 * Typical: Hub `pnpm tauri-dev` or `horizon-gateway-serve` running.
 *
 * Usage:
 *   node scripts/smoke-serve-dual-attach.mjs
 *
 * Checks:
 *   1. IPC ping succeeds
 *   2. Exactly one horizon-gateway-serve process (best-effort on Windows)
 *   3. Two concurrent TCP subscribers to the event port
 *   4. PID unchanged after a second ping (attach does not require kill)
 */
import net from "node:net";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const IPC_HOST = "127.0.0.1";
const IPC_PORT = 17345;
const EVENT_PORT = 17346;

function fail(msg) {
  console.error(`[smoke-serve-dual-attach] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.info(`[smoke-serve-dual-attach] OK: ${msg}`);
}

function pingIpc() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: IPC_PORT }, () => {
      const req = {
        id: randomUUID(),
        protocolVersion: 1,
        command: "ping",
        payload: null,
      };
      socket.write(`${JSON.stringify(req)}\n`);
    });
    let buf = "";
    socket.setTimeout(3000);
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        return;
      }
      const line = buf.slice(0, nl);
      socket.destroy();
      try {
        const res = JSON.parse(line);
        if (!res.ok) {
          reject(new Error(res.error || "ping not ok"));
          return;
        }
        resolve(res.data ?? res);
      } catch (e) {
        reject(e);
      }
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("IPC ping timeout"));
    });
    socket.on("error", reject);
  });
}

function connectEventSubscriber(label) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: EVENT_PORT }, () => {
      resolve(socket);
    });
    socket.setTimeout(3000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`${label}: event connect timeout`));
    });
    socket.on("error", (e) => reject(new Error(`${label}: ${e.message}`)));
  });
}

function countServeProcesses() {
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-Process -Name 'horizon-gateway-serve' -ErrorAction SilentlyContinue | Measure-Object).Count",
      ],
      { encoding: "utf8" },
    );
    const n = Number.parseInt((r.stdout || "").trim(), 10);
    return Number.isFinite(n) ? n : -1;
  }
  const r = spawnSync("pgrep", ["-c", "horizon-gateway-serve"], { encoding: "utf8" });
  // pgrep -c may not exist on all unix; fall back
  if (r.status === 0) {
    const n = Number.parseInt((r.stdout || "").trim(), 10);
    return Number.isFinite(n) ? n : -1;
  }
  const r2 = spawnSync("pgrep", ["-f", "horizon-gateway-serve"], { encoding: "utf8" });
  if (r2.status !== 0) {
    return 0;
  }
  return (r2.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean).length;
}

function servePids() {
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-Process -Name 'horizon-gateway-serve' -ErrorAction SilentlyContinue).Id -join ','",
      ],
      { encoding: "utf8" },
    );
    return (r.stdout || "")
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const r = spawnSync("pgrep", ["-f", "horizon-gateway-serve"], { encoding: "utf8" });
  if (r.status !== 0) {
    return [];
  }
  return (r.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function main() {
  let pingData;
  try {
    pingData = await pingIpc();
  } catch (e) {
    fail(`IPC ping failed (${e.message}). Start Hub or horizon-gateway-serve first.`);
  }
  ok(`IPC ping (${typeof pingData === "object" ? JSON.stringify(pingData) : pingData})`);

  const pidsBefore = servePids();
  const count = countServeProcesses();
  if (count === 0) {
    fail("ping ok but no horizon-gateway-serve process found (unexpected)");
  }
  if (count > 1) {
    console.warn(`[smoke-serve-dual-attach] WARN: ${count} serve processes: ${pidsBefore.join(",")}`);
  } else {
    ok(`single serve process pid=${pidsBefore[0] ?? "?"}`);
  }

  let a;
  let b;
  try {
    a = await connectEventSubscriber("A");
    b = await connectEventSubscriber("B");
  } catch (e) {
    a?.destroy();
    b?.destroy();
    fail(`event subscribe: ${e.message}`);
  }
  ok("two event subscribers connected on :17346");

  // Second ping while both event sockets held — attach-style reuse.
  try {
    await pingIpc();
  } catch (e) {
    a.destroy();
    b.destroy();
    fail(`second IPC ping failed: ${e.message}`);
  }

  const pidsAfter = servePids();
  a.destroy();
  b.destroy();

  if (pidsBefore.join(",") !== pidsAfter.join(",")) {
    fail(`serve PID changed during attach smoke (${pidsBefore} -> ${pidsAfter})`);
  }
  ok(`serve PID stable across dual-attach (${pidsAfter.join(",") || "unknown"})`);
  ok("all checks passed");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
