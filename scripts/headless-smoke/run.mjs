/**
 * Shared headless daemon smoke. OS entry scripts supply a profile.
 *
 *   HG_SERVE_HEADLESS=1 horizon-gateway-serve
 *     → wait for 127.0.0.1:17345
 *     → hgc create_mock_rule + start_local_proxy
 *     → HTTP via proxy port 8888
 *     → hgc get_api_logs / get_api_log_detail
 *     → hgc shutdown_serve
 *
 * Linux also checks the child has no DISPLAY or WAYLAND_DISPLAY via /proc.
 * Windows and macOS assert the same scenario and the headless line in serve.log.
 *
 * Data dir is a temp directory (`HG_DATA_DIR`), not the developer data dir.
 * Control and proxy ports are still fixed (17345 / 17346 / 8888). If one is
 * already taken this script exits; it does not kill another process.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IPC_PORT = 17345;
const EVENT_PORT = 17346;
const PROXY_PORT = 8888;
const MOCK_HOST = "smoke.horizon-gateway.invalid";
const MOCK_PATH = "/hg-smoke";
const MOCK_BODY = "hg-smoke-ok";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const linuxProfile = {
  id: "linux",
  platform: "linux",
  exeSuffix: "",
  checkDisplay: true,
};

export const windowsProfile = {
  id: "windows",
  platform: "win32",
  exeSuffix: ".exe",
  checkDisplay: false,
};

export const macosProfile = {
  id: "macos",
  platform: "darwin",
  exeSuffix: "",
  checkDisplay: false,
};

const profiles = [linuxProfile, windowsProfile, macosProfile];

export function profileForPlatform(platform) {
  return profiles.find((profile) => profile.platform === platform) ?? null;
}

function fail(msg) {
  console.error(`[smoke-headless-serve] FAIL: ${msg}`);
  process.exitCode = 1;
  const err = new Error(msg);
  err.smokeFailed = true;
  throw err;
}

function ok(msg) {
  console.info(`[smoke-headless-serve] OK: ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function portOpen(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function withExeSuffix(name, exeSuffix) {
  if (!exeSuffix || name.toLowerCase().endsWith(exeSuffix)) {
    return name;
  }
  return `${name}${exeSuffix}`;
}

function resolveBin(envName, fallbackName, exeSuffix) {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const fileName = withExeSuffix(fallbackName, exeSuffix);
  const targetDir = process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(repoRoot, "src-tauri", "target");
  const debug = path.join(targetDir, "debug", fileName);
  const release = path.join(targetDir, "release", fileName);
  if (existsSync(debug)) {
    return debug;
  }
  if (existsSync(release)) {
    return release;
  }
  return debug;
}

function ensureBins(profile) {
  let serveBin = resolveBin("HG_SERVE_BIN", "horizon-gateway-serve", profile.exeSuffix);
  let hgcBin = resolveBin("HG_HGC_BIN", "hgc", profile.exeSuffix);
  if (existsSync(serveBin) && existsSync(hgcBin)) {
    return { serveBin, hgcBin };
  }
  console.info("[smoke-headless-serve] building horizon-gateway-serve and hgc");
  const built = spawnSync("cargo", ["build", "-p", "horizon-gateway-serve", "-p", "hgc"], {
    cwd: path.join(repoRoot, "src-tauri"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (built.status !== 0) {
    fail(`cargo build failed (status ${built.status ?? "null"})`);
  }
  serveBin = resolveBin("HG_SERVE_BIN", "horizon-gateway-serve", profile.exeSuffix);
  hgcBin = resolveBin("HG_HGC_BIN", "hgc", profile.exeSuffix);
  if (!existsSync(serveBin) || !existsSync(hgcBin)) {
    fail(`binaries missing after build (serve=${serveBin}, hgc=${hgcBin})`);
  }
  return { serveBin, hgcBin };
}

function childEnv(dataDir, profile) {
  const env = { ...process.env, HG_DATA_DIR: dataDir };
  if (profile.checkDisplay) {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }
  return env;
}

function runHgc(hgcBin, dataDir, profile, args) {
  const result = spawnSync(hgcBin, args, {
    encoding: "utf8",
    env: childEnv(dataDir, profile),
    timeout: 30_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    fail(`hgc ${args[0]} spawn error: ${result.error.message}\n${stderr}`);
  }
  if (result.status !== 0) {
    fail(`hgc ${args.join(" ")} exited ${result.status}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  let json;
  try {
    json = JSON.parse(stdout);
  } catch (e) {
    fail(`hgc ${args[0]} stdout is not JSON (${e.message})\n${stdout}`);
  }
  return json;
}

function proxyRequest() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: PROXY_PORT }, () => {
      socket.write(
        `GET http://${MOCK_HOST}${MOCK_PATH} HTTP/1.1\r\n` +
          `Host: ${MOCK_HOST}\r\n` +
          "Connection: close\r\n" +
          "\r\n",
      );
    });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`proxy request timeout\n${buf.toString("utf8")}`));
    }, 5000);
    const finish = (raw) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(raw);
    };
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const raw = buf.toString("utf8");
      const parsed = parseHttp(raw);
      if (!parsed) {
        return;
      }
      const len = Number.parseInt(parsed.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(len) && Buffer.byteLength(parsed.body) >= len) {
        finish(raw);
      }
    });
    socket.on("end", () => finish(buf.toString("utf8")));
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseHttp(raw) {
  const splitAt = raw.indexOf("\r\n\r\n");
  if (splitAt === -1) {
    return null;
  }
  const head = raw.slice(0, splitAt);
  const body = raw.slice(splitAt + 4);
  const [statusLine, ...headerLines] = head.split("\r\n");
  const status = Number.parseInt(statusLine.split(" ")[1] ?? "", 10);
  const headers = new Map();
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return { status, headers, body };
}

function alive(child) {
  if (!child.pid || child.exitCode !== null) {
    return false;
  }
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childEnvHas(pid, prefix) {
  const raw = readFileSync(`/proc/${pid}/environ`);
  return raw
    .toString("utf8")
    .split("\0")
    .some((entry) => entry.startsWith(prefix));
}

function readServeLog(dataDir) {
  const logPath = path.join(dataDir, "logs", "serve.log");
  try {
    return readFileSync(logPath, "utf8");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    let listing = "";
    try {
      listing = readdirSync(dataDir, { recursive: true }).join(", ");
    } catch (listError) {
      listing = listError instanceof Error ? listError.message : String(listError);
    }
    return `(unreadable ${logPath}: ${detail}; dataDir=[${listing}])`;
  }
}

async function waitForServe(child, dataDir) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!alive(child)) {
      fail(
        `serve exited before the control socket was up (code=${child.exitCode}).\n` +
          `stderr:\n${child.stderrText ?? ""}\nlog:\n${readServeLog(dataDir)}`,
      );
    }
    if (await portOpen(IPC_PORT)) {
      return;
    }
    await sleep(200);
  }
  fail(
    `timed out waiting for 127.0.0.1:${IPC_PORT}.\n` +
      `stderr:\n${child.stderrText ?? ""}\nlog:\n${readServeLog(dataDir)}`,
  );
}

function stopChild(child) {
  if (process.platform === "win32") {
    child.kill();
    return;
  }
  child.kill("SIGTERM");
}

async function run(profile) {
  if (process.platform !== profile.platform) {
    fail(`this smoke runs on ${profile.id} (got ${process.platform})`);
  }

  for (const port of [IPC_PORT, EVENT_PORT, PROXY_PORT]) {
    if (await portOpen(port)) {
      fail(
        `127.0.0.1:${port} is already in use. Stop the other horizon-gateway-serve ` +
          "(fixed ports; discovery is plan PR 3) and retry.",
      );
    }
  }

  const { serveBin, hgcBin } = ensureBins(profile);
  const dataDir = mkdtempSync(path.join(tmpdir(), "hg-headless-smoke-"));
  ok(`profile=${profile.id}`);
  ok(`isolated HG_DATA_DIR=${dataDir}`);
  ok(`serve=${serveBin}`);
  ok(`hgc=${hgcBin}`);

  let child;
  let stdoutText = "";
  let stderrText = "";
  try {
    child = spawn(serveBin, [], {
      env: { ...childEnv(dataDir, profile), HG_SERVE_HEADLESS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf8");
      if (stdoutText.length > 80_000) {
        stdoutText = stdoutText.slice(-40_000);
      }
    });
    child.stderrText = "";
    child.stderr.on("data", (chunk) => {
      stderrText += chunk.toString("utf8");
      if (stderrText.length > 80_000) {
        stderrText = stderrText.slice(-40_000);
      }
      child.stderrText = stderrText;
    });

    await waitForServe(child, dataDir);
    if (!alive(child)) {
      fail("control socket accepted but the serve process is gone");
    }
    if (profile.checkDisplay) {
      if (childEnvHas(child.pid, "DISPLAY=") || childEnvHas(child.pid, "WAYLAND_DISPLAY=")) {
        fail("serve child inherited a display; this smoke unsets DISPLAY and WAYLAND_DISPLAY");
      }
      if (!childEnvHas(child.pid, "HG_SERVE_HEADLESS=1")) {
        fail("serve child is missing HG_SERVE_HEADLESS=1");
      }
      ok(`control socket up; serve pid=${child.pid} still alive with no DISPLAY`);
    } else {
      ok(`control socket up; serve pid=${child.pid} still alive`);
    }

    const logDeadline = Date.now() + 5_000;
    let serveLog = "";
    while (Date.now() < logDeadline) {
      serveLog = readServeLog(dataDir);
      if (serveLog.includes("headless: tray and GUI spawn skipped")) {
        break;
      }
      await sleep(100);
    }
    if (!serveLog.includes("headless: tray and GUI spawn skipped")) {
      fail(
        `serve.log did not record the headless branch.\n${serveLog}\nstderr:\n${stderrText}\nstdout:\n${stdoutText}`,
      );
    }
    ok("serve.log: headless branch (tray skipped, accept loop holds the process)");

    const ping = runHgc(hgcBin, dataDir, profile, ["ping", "{}"]);
    if (ping.ok !== true || ping.mode !== "serve") {
      fail(`unexpected ping: ${JSON.stringify(ping)}`);
    }
    ok(`hgc ping mode=${ping.mode} version=${ping.version}`);

    const created = runHgc(hgcBin, dataDir, profile, [
      "create_mock_rule",
      JSON.stringify({
        name: "hg-smoke",
        scenarioId: null,
        host: MOCK_HOST,
        method: "GET",
        urlPattern: MOCK_PATH,
        responseStatus: 200,
        responseHeaders: { "content-type": "text/plain; charset=utf-8" },
        responseBody: MOCK_BODY,
        enabled: true,
      }),
    ]);
    if (created.success !== true || created.data?.enabled !== true) {
      fail(`create_mock_rule failed: ${JSON.stringify(created)}`);
    }
    ok(`mock rule id=${created.data.id} host=${MOCK_HOST} path=${MOCK_PATH}`);

    let started = null;
    let startError = "";
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const result = spawnSync(hgcBin, ["start_local_proxy", "{}"], {
        encoding: "utf8",
        env: childEnv(dataDir, profile),
        timeout: 30_000,
      });
      if (result.status === 0) {
        try {
          started = JSON.parse(result.stdout ?? "");
        } catch (e) {
          fail(`start_local_proxy stdout is not JSON (${e.message})\n${result.stdout}`);
        }
        break;
      }
      startError = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
      await sleep(200);
    }
    if (!started?.success || started.data?.running !== true || started.data?.port !== PROXY_PORT) {
      fail(
        `start_local_proxy did not bind :${PROXY_PORT}: ${JSON.stringify(started)}\n${startError}`,
      );
    }
    ok(`proxy running on ${started.data.port} (${started.message})`);

    let raw = "";
    let parsed = null;
    let proxyError = "";
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        raw = await proxyRequest();
        parsed = parseHttp(raw);
        if (parsed && parsed.status === 200 && parsed.body.includes(MOCK_BODY)) {
          break;
        }
        proxyError = raw;
        parsed = null;
      } catch (e) {
        proxyError = e instanceof Error ? e.message : String(e);
      }
      await sleep(200);
    }
    if (!parsed) {
      fail(`proxied request did not return the mock body.\n${proxyError}`);
    }
    if (parsed.headers.get("x-mocked-by") !== "horizon-gateway") {
      fail(`missing x-mocked-by header.\n${raw}`);
    }
    ok(`proxied GET returned ${parsed.status} body=${JSON.stringify(parsed.body.trim())}`);

    if (!alive(child)) {
      fail(
        `serve died after the proxied request (code=${child.exitCode}).\n` +
          `stderr:\n${stderrText}\nstdout:\n${stdoutText}\nlog:\n${readServeLog(dataDir)}`,
      );
    }
    ok(`serve pid=${child.pid} still alive after the proxied request`);

    const dates = [...new Set([localDateString(), utcDateString()])];
    let captured = null;
    let listed = null;
    for (const date of dates) {
      const logs = runHgc(hgcBin, dataDir, profile, [
        "get_api_logs",
        JSON.stringify({
          date,
          domainFilter: null,
          methodFilter: "GET",
          hostFilter: MOCK_HOST,
          exactMatch: null,
        }),
      ]);
      listed = logs;
      const rows = Array.isArray(logs.data) ? logs.data : [];
      captured = rows.find(
        (row) => row.path === MOCK_PATH && row.is_mocked === true && row.status_code === 200,
      );
      if (captured) {
        ok(`captured via get_api_logs date=${date} id=${captured.id}`);
        const detail = runHgc(hgcBin, dataDir, profile, [
          "get_api_log_detail",
          JSON.stringify({ id: captured.id, date }),
        ]);
        if (detail.data?.response_body !== MOCK_BODY) {
          fail(`get_api_log_detail body mismatch: ${JSON.stringify(detail)}`);
        }
        ok("get_api_log_detail response_body matches the mock");
        break;
      }
    }
    if (!captured) {
      fail(`request was not captured.\n${JSON.stringify(listed)}`);
    }

    const stopped = runHgc(hgcBin, dataDir, profile, ["shutdown_serve", "{}"]);
    if (stopped.ok !== true || stopped.stopping !== true) {
      fail(`shutdown_serve unexpected: ${JSON.stringify(stopped)}`);
    }
    const exitDeadline = Date.now() + 5_000;
    while (Date.now() < exitDeadline && alive(child)) {
      await sleep(100);
    }
    if (alive(child) || child.exitCode !== 0) {
      fail(
        `serve did not exit cleanly after shutdown_serve (alive=${alive(child)} code=${child.exitCode} signal=${child.signalCode})`,
      );
    }
    ok("serve exited 0 after shutdown_serve");
    ok("all checks passed");
  } finally {
    if (child && alive(child)) {
      stopChild(child);
      await sleep(300);
      if (alive(child)) {
        child.kill("SIGKILL");
      }
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

export function main(profile) {
  if (!profile) {
    console.error(
      `[smoke-headless-serve] FAIL: no headless smoke for platform ${process.platform}`,
    );
    process.exitCode = 1;
    return;
  }
  run(profile).catch((e) => {
    if (!e?.smokeFailed) {
      console.error(`[smoke-headless-serve] FAIL: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });
}
