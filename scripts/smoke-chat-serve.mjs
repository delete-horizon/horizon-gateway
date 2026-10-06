/**
 * Step 1 smoke: chat_* IPC on horizon-gateway-serve + frame event fan-out.
 *
 * Prerequisites: rebuilt serve listening on :17345 / :17346.
 *
 * Usage:
 *   node scripts/smoke-chat-serve.mjs
 */
import net from "node:net";
import { randomUUID } from "node:crypto";
import { eventHello, readServeToken } from "./serve-token.mjs";

const IPC_HOST = "127.0.0.1";
const IPC_PORT = 17345;
const EVENT_PORT = 17346;

function fail(msg) {
  console.error(`[smoke-chat-serve] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.info(`[smoke-chat-serve] OK: ${msg}`);
}

function callCommand(command, payload = null) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: IPC_PORT }, () => {
      const req = {
        id: randomUUID(),
        protocolVersion: 1,
        token: readServeToken(),
        command,
        payload,
      };
      socket.write(`${JSON.stringify(req)}\n`);
    });
    let buf = "";
    socket.setTimeout(5000);
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      socket.destroy();
      try {
        const res = JSON.parse(line);
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

function waitEvent(eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: IPC_HOST, port: EVENT_PORT }, () => {
      socket.write(eventHello());
      // connected; wait for NDJSON
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
            resolve(evt.payload);
          }
        } catch {
          // ignore partial/bad lines
        }
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function sendRawFrame(host, port, frameJson) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      const bytes = Buffer.from(frameJson, "utf8");
      const len = Buffer.alloc(4);
      len.writeUInt32BE(bytes.length, 0);
      socket.write(Buffer.concat([len, bytes]));
      socket.end();
      resolve();
    });
    socket.setTimeout(3000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("sendRawFrame timeout"));
    });
    socket.on("error", reject);
  });
}

async function main() {
  await callCommand("ping");
  ok("ping");

  const identity = await callCommand("chat_ensure_identity");
  if (!identity?.deviceId || !identity?.publicKey) {
    fail(`bad identity: ${JSON.stringify(identity)}`);
  }
  ok(`identity deviceId=${identity.deviceId.slice(0, 8)}…`);

  const roomKey = await callCommand("chat_generate_room_key");
  if (typeof roomKey !== "string" || roomKey.length < 16) {
    fail(`bad room key: ${roomKey}`);
  }
  const sealed = await callCommand("chat_seal", {
    roomKey,
    plaintext: "smoke-hello",
  });
  const opened = await callCommand("chat_open", {
    roomKey,
    ciphertext: sealed,
  });
  if (opened !== "smoke-hello") {
    fail(`seal roundtrip got ${opened}`);
  }
  ok("seal/open roundtrip");

  const listen = await callCommand("chat_start_listener");
  if (!listen?.port || !Array.isArray(listen.lanHosts)) {
    fail(`bad listen info: ${JSON.stringify(listen)}`);
  }
  ok(`listener port=${listen.port} hosts=${listen.lanHosts.join(",")}`);

  const framePromise = waitEvent("chat-frame-received", 8000);
  // Give subscriber a moment to attach before sending.
  await new Promise((r) => setTimeout(r, 200));
  const payload = JSON.stringify({ type: "smoke", t: Date.now() });
  await sendRawFrame("127.0.0.1", listen.port, payload);
  const received = await framePromise;
  if (received !== payload) {
    fail(`frame mismatch: got ${JSON.stringify(received)}`);
  }
  ok("chat-frame-received fan-out");

  await callCommand("chat_stop_listener");
  ok("stop listener");
  ok("all checks passed");
}

main().catch((e) => fail(e.message || String(e)));
