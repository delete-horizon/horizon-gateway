/**
 * Applies the repo migrations on a throwaway local Postgres and checks
 * accept_workspace_invite. Requires a local cluster reachable as
 * `sudo -u postgres psql` (no production connection).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = "hg_accept_invite_test";

const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const outsider = "55555555-5555-4555-8555-555555555555";
const alice = "66666666-6666-4666-8666-666666666666";
const bob = "77777777-7777-4777-8777-777777777777";
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const shareToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const emailToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function psql(db, sql, { quiet = false } = {}) {
  const args = ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", db];
  if (quiet) {
    args.push("-q");
  }
  return execFileSync("sudo", args, {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function psqlFile(db, file) {
  return psql(db, readFileSync(file, "utf8"), { quiet: true });
}

function ensureCluster() {
  try {
    execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "select 1"], { encoding: "utf8" });
  } catch {
    execFileSync("sudo", ["service", "postgresql", "start"], { encoding: "utf8" });
  }
}

ensureCluster();
execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`], {
  encoding: "utf8",
});
execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`], {
  encoding: "utf8",
});

psql(
  database,
  `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  provider text,
  provider_id text,
  identity_data jsonb
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
`,
);

const migrations = readdirSync(path.join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
for (const name of migrations) {
  const file = path.join(root, "supabase/migrations", name);
  try {
    psqlFile(database, file);
  } catch (error) {
    const message = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    if (name.startsWith("20261014031727") && message.includes("pg_cron")) {
      console.warn("refund retention cron was not scheduled (pg_cron is absent); invite checks continue");
      continue;
    }
    throw error;
  }
}

const report = psql(
  database,
  `
insert into auth.users (id, email) values
  ('${owner}', 'owner@example.com'),
  ('${admin}', 'admin@example.com'),
  ('${outsider}', 'outsider@example.com'),
  ('${alice}', 'alice@example.com'),
  ('${bob}', 'bob@example.com');

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '${owner}', false);
insert into public.workspaces (id, name, owner_id, plan, seat_limit, status)
values ('${workspace}', 'Team', '${owner}', 'free', 5, 'active');
insert into public.workspace_members (workspace_id, profile_id, role) values
  ('${workspace}', '${owner}', 'owner'),
  ('${workspace}', '${admin}', 'admin');

create temporary table invite_results (name text primary key, outcome text);

-- Admin creates the shareable invite the same way createShareableInvite does.
do $$
declare
  result json;
  joined_role text;
  invite_status text;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '${admin}', true);
  perform set_config('request.jwt.claims', '{"email":"admin@example.com","role":"authenticated"}', true);
  insert into public.workspace_invites (workspace_id, email, role, invited_by, token, status)
  values ('${workspace}', 'link@shareable', 'admin', '${admin}', '${shareToken}', 'pending');

  perform set_config('request.jwt.claim.sub', '${outsider}', true);
  perform set_config('request.jwt.claims', '{"email":"outsider@example.com","role":"authenticated"}', true);
  if exists (
    select 1 from public.workspace_members
    where workspace_id = '${workspace}' and profile_id = '${outsider}'
  ) then
    insert into invite_results values ('shareable outsider was absent', 'already a member');
  else
    insert into invite_results values ('shareable outsider was absent', 'absent');
  end if;

  result := public.accept_workspace_invite('${shareToken}');
  select m.role into joined_role
  from public.workspace_members m
  where m.workspace_id = '${workspace}' and m.profile_id = '${outsider}';
  select wi.status into invite_status
  from public.workspace_invites wi
  where wi.token = '${shareToken}';

  if result ->> 'error' is not null then
    insert into invite_results values ('shareable outsider joins', result ->> 'error');
  else
    insert into invite_results values ('shareable outsider joins', coalesce(joined_role, 'missing'));
  end if;
  insert into invite_results values ('shareable invite status', coalesce(invite_status, 'missing'));
exception when others then
  insert into invite_results values ('shareable outsider joins', sqlerrm);
end $$;

do $$
declare
  result json;
  bob_count integer;
  alice_role text;
  invite_status text;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '${admin}', true);
  perform set_config('request.jwt.claims', '{"email":"admin@example.com","role":"authenticated"}', true);
  insert into public.workspace_invites (workspace_id, email, role, invited_by, token, status)
  values ('${workspace}', 'alice@example.com', 'member', '${admin}', '${emailToken}', 'pending');

  perform set_config('request.jwt.claim.sub', '${bob}', true);
  perform set_config('request.jwt.claims', '{"email":"bob@example.com","role":"authenticated"}', true);
  result := public.accept_workspace_invite('${emailToken}');
  select count(*) into bob_count
  from public.workspace_members
  where workspace_id = '${workspace}' and profile_id = '${bob}';
  select wi.status into invite_status
  from public.workspace_invites wi
  where wi.token = '${emailToken}';
  insert into invite_results values ('email mismatch', coalesce(result ->> 'error', result ->> 'role', 'accepted'));
  insert into invite_results values ('email mismatch membership', bob_count::text);
  insert into invite_results values ('email invite after mismatch', coalesce(invite_status, 'missing'));

  perform set_config('request.jwt.claim.sub', '${alice}', true);
  perform set_config('request.jwt.claims', '{"email":"Alice@Example.com","role":"authenticated"}', true);
  result := public.accept_workspace_invite('${emailToken}');
  select m.role into alice_role
  from public.workspace_members m
  where m.workspace_id = '${workspace}' and m.profile_id = '${alice}';
  select wi.status into invite_status
  from public.workspace_invites wi
  where wi.token = '${emailToken}';
  if result ->> 'error' is not null then
    insert into invite_results values ('email match joins', result ->> 'error');
  else
    insert into invite_results values ('email match joins', coalesce(alice_role, 'missing'));
  end if;
  insert into invite_results values ('email invite after match', coalesce(invite_status, 'missing'));
exception when others then
  insert into invite_results values ('email match joins', sqlerrm);
end $$;

select name, outcome from invite_results order by name;
`,
);

const expected = new Map([
  ["email invite after match", "accepted"],
  ["email invite after mismatch", "pending"],
  ["email match joins", "member"],
  ["email mismatch", "invite not found"],
  ["email mismatch membership", "0"],
  ["shareable invite status", "accepted"],
  ["shareable outsider joins", "admin"],
  ["shareable outsider was absent", "absent"],
]);

const actual = new Map();
for (const line of report.split("\n")) {
  const match = line.match(/^\s([^|]+?)\s+\|\s+([^|]+?)\s*$/);
  if (!match) {
    continue;
  }
  const name = match[1].trim();
  if (expected.has(name)) {
    actual.set(name, match[2].trim());
  }
}

const failures = [];
for (const [name, outcome] of expected) {
  if (actual.get(name) !== outcome) {
    failures.push(`${name}: expected ${outcome}, got ${actual.get(name) ?? "missing"}`);
  }
}

if (failures.length > 0) {
  console.error(report);
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("PASS accept_workspace_invite");
for (const [name, outcome] of expected) {
  console.log(`${name}: ${outcome}`);
}
