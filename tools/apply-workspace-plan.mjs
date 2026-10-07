/**
 * Apply workspace plan migration + backfill Example FE to pro for the test purchase.
 * Uses Supabase Management API SQL (requires SUPABASE_ACCESS_TOKEN).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = loadEnv(".env");
const PROJECT_REF = "fcngkhnadezrggqgwhuk";
const WORKSPACE_ID = "dae9f748-edd4-47ab-a092-b14926e567cb";

const sql = readFileSync("supabase/migrations/20260806000000_workspace_plan.sql", "utf8");

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`SQL failed ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

console.log("Applying migration...");
await runSql(sql);
console.log("Migration OK");

console.log("Backfilling Example FE → pro (test purchase)...");
await runSql(`
  update public.workspaces
  set plan = 'pro',
      seat_limit = 5,
      status = 'active',
      ls_subscription_id = coalesce(ls_subscription_id, 'manual-test-backfill')
  where id = '${WORKSPACE_ID}';
`);
console.log("Backfill OK");

const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb.from("workspaces").select("id,name,plan,seat_limit,status,ls_subscription_id").eq("id", WORKSPACE_ID).single();
if (error) throw error;
console.log("Workspace now:", data);

console.log("\nRedeploying webhook...");
const r = spawnSync(
  "pnpm",
  ["dlx", "supabase", "functions", "deploy", "lemon-squeezy-webhook", "--project-ref", PROJECT_REF, "--no-verify-jwt"],
  {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN },
    encoding: "utf8",
    shell: true,
    stdio: "inherit",
  },
);
process.exit(r.status || 0);
