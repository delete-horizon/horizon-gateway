/**
 * Step 2 smoke: session_handoff_put / take is one-shot and does not echo tokens on the event.
 *
 * Prerequisites: rebuilt serve on :17345 / :17346.
 *
 * Usage:
 *   node scripts/smoke-session-handoff.mjs
 */
import net from "node:net";
import { randomUUID } from "node:crypto";
import { eventHello, readServeToken } from "./serve-token.mjs";

const IPC_HOST = "127.0.0.1";
const IPC_PORT = 17345;
const EVENT_PORT = 17346;

function fail(msg) {
  console.error(`[smoke-session-handoff] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.info(`[smoke-session-handoff] OK: ${msg}`);
}

function callCommand(command, payload = null) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: IPC_PORT }, () => {
      socket.write(
        `${JSON.stringify({
          id: randomUUID(),
          protocolVersion: 1,
          token: readServeToken(),
          command,
          payload,
        })}\n`,
      );
    });
    let buf = "";
    socket.setTimeout(5000);
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      socket.destroy();
      try {
        const res = JSON.parse(buf.slice(0, nl));
        if (!res.ok) {
          reject(new Error(res.error || `${command} not ok`));
          return;
        }
        resolve(res.data);
      } catch (e) {
        reject(e);
      }
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`${command} timeout`));
    });
    socket.on("error", reject);
  });
}

function waitEvent(eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: EVENT_PORT }, () => {
      socket.write(eventHello());
    });
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`event ${eventName} timeout`));
    }, timeoutMs);
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.event === eventName) {
            clearTimeout(timer);
            socket.destroy();
            resolve(evt);
          }
        } catch {
          // ignore
        }
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  await callCommand("ping");
  const eventPromise = waitEvent("session-handoff");
  await new Promise((r) => setTimeout(r, 150));

  const access = `access-${randomUUID()}`;
  const refresh = `refresh-${randomUUID()}`;
  const put = await callCommand("session_handoff_put", {
    accessToken: access,
    refreshToken: refresh,
  });
  if (!put?.ready) {
    fail(`put response ${JSON.stringify(put)}`);
  }
  ok("put");

  const evt = await eventPromise;
  const blob = JSON.stringify(evt);
  if (blob.includes(access) || blob.includes(refresh)) {
    fail("event leaked tokens");
  }
  if (!evt.payload?.ready) {
    fail(`event payload ${blob}`);
  }
  ok("event signal without tokens");

  const taken = await callCommand("session_handoff_take");
  if (taken?.accessToken !== access || taken?.refreshToken !== refresh) {
    fail("take mismatch");
  }
  ok("take once");

  const again = await callCommand("session_handoff_take");
  if (again != null) {
    fail(`second take should be empty, got ${JSON.stringify(again)}`);
  }
  ok("second take empty");
  ok("all checks passed");
}

main().catch((e) => fail(e.message || String(e)));
