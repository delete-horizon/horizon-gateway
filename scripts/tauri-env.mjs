import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const val = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = val;
  }
}

function isLocalSupabaseUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

// Later files override earlier (user .env first, then generated overlay).
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

if (isLocalSupabaseUrl(process.env.VITE_SUPABASE_URL || "")) {
  const ensure = spawnSync(process.execPath, [path.join(__dirname, "ensure-supabase-local.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (ensure.status !== 0) {
    console.error("[tauri-env] local Supabase ensure failed — aborting tauri dev");
    process.exit(ensure.status ?? 1);
  }
  // Re-load generated keys so Vite child inherits them (highest priority over .env files).
  loadEnvFile(path.join(root, ".env.supabase.local"));
}

const cliPath = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);
const tauriDir = path.join(root, "src-tauri");

if (args[0] === "dev") {
  const cargo = spawnSync("cargo", ["build", "-p", "horizon-gateway-serve", "-p", "hgc"], {
    cwd: tauriDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (cargo.status !== 0) {
    console.warn(
      "[tauri] cargo build -p horizon-gateway-serve failed. If the exe is locked, stop horizon-gateway-serve and retry.",
    );
  }
}

const defaultConfig = path.join(root, "src-tauri/hg-gui/tauri.conf.json");
const configFlag = ["--config", "-c"];
const hasConfig = args.some(
  (a, i) => configFlag.includes(a) || (i > 0 && configFlag.includes(args[i - 1])),
);
const tauriArgs =
  hasConfig || args.length === 0 ? args : [args[0], "--config", defaultConfig, ...args.slice(1)];

const child = spawn(process.execPath, [cliPath, ...tauriArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
