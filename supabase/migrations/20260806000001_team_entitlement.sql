-- Owner / internal team entitlement (always Pro or Unlimited without Lemon billing)
-- Safe to re-run.

alter table public.profiles
  add column if not exists team_entitlement text;

do $$
begin
  alter table public.profiles
    add constraint profiles_team_entitlement_check
    check (team_entitlement is null or team_entitlement in ('pro', 'unlimited'));
exception
  when duplicate_object then null;
end $$;

-- HISTORICAL (do not copy this pattern): one-time prod owner grant baked into an
-- early migration. New per-user entitlements belong in ensure/seed (local) or
-- dashboard/webhook (prod) — never new personal UID UPDATEs in migrations.
-- Left in place so already-applied remote history stays consistent.
update public.profiles
set team_entitlement = 'unlimited'
where id = '142b1dfb-cae3-4c56-b5c7-54a3b4036b37';
