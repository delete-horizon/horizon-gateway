/**
 * Ensure local Supabase is running and env-dev user exists.
 *
 * Triggered when VITE_SUPABASE_URL points at localhost/127.0.0.1.
 * Injects API_URL / ANON_KEY / SERVICE_ROLE_KEY into process.env for the caller.
 *
 * Usage: node scripts/ensure-supabase-local.mjs
 * Exit 0 on success; non-zero aborts tauri (do not fall through to cloud).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadDotenv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
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
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
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

function fail(message) {
  console.error(`[ensure-supabase-local] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  return result;
}

function supabaseArgs(args) {
  // Prefer local binary, fall back to npx.
  const local = run("supabase", ["--version"], { stdio: "pipe" });
  if (local.status === 0) {
    return { command: "supabase", args };
  }
  return { command: "npx", args: ["--yes", "supabase", ...args] };
}

function runSupabase(args, options = {}) {
  const { command, args: fullArgs } = supabaseArgs(args);
  return run(command, fullArgs, options);
}

function parseStatusEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    let val = trimmed.slice(index + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function ensureDevUser(apiUrl, serviceRoleKey) {
  const email = (process.env.VITE_DEV_LOCAL_EMAIL || "").trim();
  const password = (process.env.VITE_DEV_LOCAL_PASSWORD || "").trim();
  if (!email || !password) {
    console.warn(
      "[ensure-supabase-local] VITE_DEV_LOCAL_EMAIL/PASSWORD not set — skip user upsert (app will not auto-login).",
    );
    return;
  }

  const displayName = (process.env.VITE_DEV_LOCAL_DISPLAY_NAME || "Local Dev").trim();
  const githubLogin = (process.env.VITE_DEV_LOCAL_GITHUB_LOGIN || "local-dev").trim();
  const entitlementRaw = (process.env.VITE_DEV_LOCAL_TEAM_ENTITLEMENT || "unlimited").trim();
  const teamEntitlement =
    entitlementRaw === "pro" || entitlementRaw === "unlimited" ? entitlementRaw : "unlimited";

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(`${apiUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!listRes.ok) {
    fail(`list users failed: ${listRes.status} ${await listRes.text()}`);
  }
  const listJson = await listRes.json();
  const users = Array.isArray(listJson) ? listJson : (listJson.users ?? []);
  let user = users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());

  if (!user) {
    const createRes = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          name: displayName,
          user_name: githubLogin,
          preferred_username: githubLogin,
        },
      }),
    });
    if (!createRes.ok) {
      fail(`create user failed: ${createRes.status} ${await createRes.text()}`);
    }
    user = await createRes.json();
    console.info(`[ensure-supabase-local] created user ${email} (${user.id})`);
  } else {
    const updateRes = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: {
          ...(user.user_metadata ?? {}),
          full_name: displayName,
          name: displayName,
          user_name: githubLogin,
          preferred_username: githubLogin,
        },
      }),
    });
    if (!updateRes.ok) {
      fail(`update user failed: ${updateRes.status} ${await updateRes.text()}`);
    }
    user = await updateRes.json();
    console.info(`[ensure-supabase-local] updated user ${email} (${user.id})`);
  }

  const profileRes = await fetch(`${apiUrl}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: user.id,
      email,
      display_name: displayName,
      github_login: githubLogin,
      team_entitlement: teamEntitlement,
    }),
  });
  if (!profileRes.ok) {
    fail(`upsert profile failed: ${profileRes.status} ${await profileRes.text()}`);
  }
  console.info(`[ensure-supabase-local] profile ready for ${user.id} (entitlement=${teamEntitlement})`);
}

async function main() {
  loadDotenv();

  const url = process.env.VITE_SUPABASE_URL || "";
  if (!isLocalSupabaseUrl(url)) {
    console.info("[ensure-supabase-local] non-local VITE_SUPABASE_URL — skip");
    return;
  }

  const docker = run("docker", ["info"], { stdio: "pipe" });
  if (docker.status !== 0) {
    fail("Docker is not running. Start Docker Desktop, then retry.");
  }

  const version = runSupabase(["--version"], { stdio: "pipe" });
  if (version.status !== 0) {
    fail("Supabase CLI not available. Install it or ensure `npx supabase` works.");
  }

  console.info("[ensure-supabase-local] starting local stack (no-op if already up)…");
  const start = runSupabase(["start"], { stdio: "inherit" });
  if (start.status !== 0) {
    fail("`supabase start` failed");
  }

  const status = runSupabase(["status", "-o", "env"], { stdio: "pipe" });
  if (status.status !== 0) {
    fail(`\`supabase status -o env\` failed: ${status.stderr || status.stdout}`);
  }
  const envMap = parseStatusEnv(status.stdout || "");
  const apiUrl = envMap.API_URL || envMap.SUPABASE_URL || "http://127.0.0.1:54321";
  const anonKey = envMap.ANON_KEY || envMap.SUPABASE_ANON_KEY;
  const serviceRoleKey = envMap.SERVICE_ROLE_KEY || envMap.SUPABASE_SERVICE_ROLE_KEY;

  if (!anonKey || !serviceRoleKey) {
    fail("Could not parse ANON_KEY / SERVICE_ROLE_KEY from `supabase status -o env`");
  }

  process.env.VITE_SUPABASE_URL = apiUrl;
  process.env.VITE_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  // Write a machine-local overlay so Vite (child) also sees injected keys.
  const overlayPath = path.join(root, ".env.supabase.local");
  fs.writeFileSync(
    overlayPath,
    [
      "# Generated by scripts/ensure-supabase-local.mjs — do not commit",
      `VITE_SUPABASE_URL=${apiUrl}`,
      `VITE_SUPABASE_ANON_KEY=${anonKey}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await ensureDevUser(apiUrl, serviceRoleKey);
  console.info(`[ensure-supabase-local] ready at ${apiUrl}`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
