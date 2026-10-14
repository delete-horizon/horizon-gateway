/**
 * Verify monetization migration against live Supabase (PostgREST + optional SQL via rpc if available).
 * Usage: node tools/verify-monetization-schema.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const env = loadEnv(resolve(process.cwd(), ".env"));
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

console.log(`Supabase: ${new URL(url).host}`);
console.log(`Using: ${service ? "service_role (+ anon)" : "anon only"}`);

const admin = createClient(url, service || anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const expectedTables = [
  "profiles",
  "feedbacks",
  "events",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "workspace_resources",
];

const expectedColumns = {
  profiles: ["github_id", "github_login", "sponsor_since", "is_sponsor", "sponsor_tier"],
  feedbacks: ["category", "app_version", "os", "install_id", "context", "content"],
  events: ["install_id", "app_version", "os", "event", "props", "ts"],
  workspaces: ["id", "name", "owner_id", "seat_limit", "status", "created_at"],
  workspace_members: ["id", "workspace_id", "profile_id", "role", "created_at"],
  workspace_invites: ["id", "workspace_id", "email", "role", "status", "token", "invited_by"],
  workspace_resources: ["id", "workspace_id", "kind", "payload", "updated_by", "updated_at"],
};

async function probeTable(table) {
  // Prefer HEAD-like select with limit 0 via range
  const { error, status } = await admin.from(table).select("*", { count: "exact", head: true });
  if (!error) {
    return { ok: true, status: status ?? 200, detail: "reachable" };
  }
  // PGRST205 = table not in schema cache; 42P01 = undefined table
  return {
    ok: false,
    status: status ?? null,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  };
}

async function probeColumns(table, columns) {
  // Selecting specific columns fails if any are missing
  const { error } = await admin.from(table).select(columns.join(",")).limit(0);
  if (!error) {
    return { ok: true, missing: [] };
  }
  const msg = error.message || "";
  const missing = columns.filter((c) => msg.includes(c) || msg.includes(`'${c}'`));
  return {
    ok: false,
    code: error.code,
    message: msg,
    missing: missing.length ? missing : ["(parse failed — see message)"],
  };
}

async function probeOpenApi() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: service || anon,
      Authorization: `Bearer ${service || anon}`,
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, tables: [] };
  }
  const spec = await res.json();
  const paths = Object.keys(spec.paths || {});
  const tables = paths
    .filter((p) => p.startsWith("/") && !p.slice(1).includes("/"))
    .map((p) => p.slice(1))
    .filter(Boolean);
  return { ok: true, tables };
}

const results = { tables: {}, columns: {}, openapi: null, notes: [] };

const openapi = await probeOpenApi();
results.openapi = openapi;

for (const table of expectedTables) {
  results.tables[table] = await probeTable(table);
  if (results.tables[table].ok) {
    results.columns[table] = await probeColumns(table, expectedColumns[table]);
  } else {
    results.columns[table] = { ok: false, skipped: true };
  }
}

// RLS smoke: anon should be able to insert into events (policy allows), but may fail without auth for workspaces
{
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: eventsInsertErr } = await anonClient.from("events").insert({
    install_id: "schema-verify-dry-run",
    app_version: "0.0.0",
    os: "verify",
    event: "__schema_verify__",
    props: { dry_run: true },
  });
  results.eventsInsertAnon = eventsInsertErr
    ? { ok: false, code: eventsInsertErr.code, message: eventsInsertErr.message }
    : { ok: true };

  // Clean up verify row if service role available
  if (!eventsInsertErr && service) {
    await admin.from("events").delete().eq("event", "__schema_verify__").eq("install_id", "schema-verify-dry-run");
  } else if (!eventsInsertErr && !service) {
    results.notes.push("events verify row left in DB (no service_role to delete)");
  }
}

// workspace create should fail for anon (needs authenticated + owner)
{
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anonClient.from("workspaces").insert({ name: "__should_fail__", owner_id: "00000000-0000-0000-0000-000000000000" });
  results.workspacesInsertAnonBlocked = error
    ? { ok: true, blocked: true, code: error.code, message: error.message }
    : { ok: false, blocked: false, message: "anon was able to insert workspace — RLS too open" };
}

// Print report
let fail = 0;
console.log("\n=== Tables ===");
for (const table of expectedTables) {
  const r = results.tables[table];
  const inOpenApi = openapi.ok ? openapi.tables.includes(table) : null;
  if (r.ok) {
    console.log(`✅ ${table}  (openapi=${inOpenApi})`);
  } else {
    fail++;
    console.log(`❌ ${table}  code=${r.code}  ${r.message}`);
  }
}

console.log("\n=== Columns ===");
for (const table of expectedTables) {
  const r = results.columns[table];
  if (r.ok) {
    console.log(`✅ ${table}: ${expectedColumns[table].join(", ")}`);
  } else if (r.skipped) {
    console.log(`⏭ ${table}: skipped (table missing)`);
  } else {
    fail++;
    console.log(`❌ ${table}: ${r.message}`);
    if (r.missing?.length) console.log(`   missing?: ${r.missing.join(", ")}`);
  }
}

console.log("\n=== RLS smoke ===");
console.log(
  results.eventsInsertAnon.ok
    ? "✅ events: anon insert allowed"
    : `❌ events: anon insert failed — ${results.eventsInsertAnon.code} ${results.eventsInsertAnon.message}`,
);
if (!results.eventsInsertAnon.ok) fail++;

console.log(
  results.workspacesInsertAnonBlocked.ok
    ? `✅ workspaces: anon insert blocked (${results.workspacesInsertAnonBlocked.code})`
    : `❌ workspaces: ${results.workspacesInsertAnonBlocked.message}`,
);
if (!results.workspacesInsertAnonBlocked.ok) fail++;

// Known gap vs plan: ls_subscription_id
{
  const { error } = await admin.from("workspaces").select("ls_subscription_id").limit(0);
  if (error) {
    results.notes.push("workspaces.ls_subscription_id missing (plan had it; migration MVP omitted — OK unless Lemon webhook needs it)");
    console.log("\n⚠ workspaces.ls_subscription_id: not present");
  } else {
    console.log("\n✅ workspaces.ls_subscription_id present");
  }
}

if (results.notes.length) {
  console.log("\n=== Notes ===");
  for (const n of results.notes) console.log(`- ${n}`);
}

console.log(fail === 0 ? "\nRESULT: PASS" : `\nRESULT: FAIL (${fail} issue(s))`);
process.exit(fail === 0 ? 0 : 2);
