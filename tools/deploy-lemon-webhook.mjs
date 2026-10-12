/**
 * Deploy lemon-squeezy-webhook with secrets from .env
 * Usage: node tools/deploy-lemon-webhook.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_REF = "fcngkhnadezrggqgwhuk";

function loadEnv(path) {
  const raw = readFileSync(path, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const envFile = loadEnv(resolve(process.cwd(), ".env"));
const accessToken = envFile.SUPABASE_ACCESS_TOKEN;
const serviceRole = envFile.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = envFile.LEMON_SQUEEZY_WEBHOOK_SECRET;

if (!accessToken) {
  console.error("Missing SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}
if (!serviceRole) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!webhookSecret) {
  console.error("Missing LEMON_SQUEEZY_WEBHOOK_SECRET");
  process.exit(1);
}

const childEnv = {
  ...process.env,
  SUPABASE_ACCESS_TOKEN: accessToken,
};

function run(args, opts = {}) {
  console.log(`\n> pnpm dlx supabase ${args.join(" ")}`);
  const r = spawnSync("pnpm", ["dlx", "supabase", ...args], {
    env: childEnv,
    encoding: "utf8",
    shell: true,
    stdio: opts.inherit ? "inherit" : "pipe",
  });
  if (!opts.inherit) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  if (r.status !== 0) {
    console.error(`Command failed with exit ${r.status}`);
    process.exit(r.status || 1);
  }
  return r;
}

// Write a temporary env file for `secrets set --env-file` to avoid shell quoting issues
const secretsPath = resolve(process.cwd(), ".env.supabase.secrets.tmp");
writeFileSync(
  secretsPath,
  [
    `LEMON_SQUEEZY_WEBHOOK_SECRET=${webhookSecret}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

try {
  run(["secrets", "set", "--env-file", secretsPath, "--project-ref", PROJECT_REF]);
  run(
    [
      "functions",
      "deploy",
      "lemon-squeezy-webhook",
      "--project-ref",
      PROJECT_REF,
      "--no-verify-jwt", // Lemon Squeezy cannot send Supabase JWT
    ],
    { inherit: true },
  );
  console.log("\nDeployed:");
  console.log(`https://${PROJECT_REF}.supabase.co/functions/v1/lemon-squeezy-webhook`);
  console.log("JWT verification disabled (--no-verify-jwt) so Lemon can POST without a Supabase anon key.");
} finally {
  try {
    unlinkSync(secretsPath);
  } catch {
    // ignore
  }
}
