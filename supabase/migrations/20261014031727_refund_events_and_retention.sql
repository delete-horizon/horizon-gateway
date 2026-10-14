-- Repeat-refund review data and privacy-policy retention.
-- Safe to re-run: IF NOT EXISTS, CREATE OR REPLACE, drop/create policies, reschedule cron.
--
-- Does not block purchases. admin_repeat_refunders is for a person to review.
--
-- Retention matches https://gateway.delete-horizon.com/privacy (13 October 2026):
--   * license key, per-install device id, and the app version on that device row
--     are deleted 1 year after the license ends (ends_at).
--   * refund-abuse email rows are deleted 3 years after that email's last refund.
-- Processors: Supabase license server in Seoul (ap-northeast-2);
-- Lemon Squeezy (Merchant of Record) in the United States.
-- pg_cron job billing-retention-cleanup runs this daily at 18:00 UTC (03:00 Asia/Seoul).

-- =====================================================================================
-- license_keys / license_devices
-- The webhook deactivates license_keys on refund. Device rows are written by license
-- activation (device id + app version). This migration only creates them and the purge.
-- =====================================================================================

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  lemon_id text not null unique,
  license_key text not null,
  order_id text,
  subscription_id text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.license_devices (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys (id) on delete cascade,
  device_id text not null,
  app_version text,
  created_at timestamptz not null default now(),
  unique (license_key_id, device_id)
);

create index if not exists license_keys_order_id_idx on public.license_keys (order_id);
create index if not exists license_keys_subscription_id_idx on public.license_keys (subscription_id);
create index if not exists license_keys_ends_at_idx on public.license_keys (ends_at) where ends_at is not null;

alter table public.license_keys enable row level security;
alter table public.license_devices enable row level security;
alter table public.license_keys force row level security;
alter table public.license_devices force row level security;

revoke all on public.license_keys from anon, authenticated;
revoke all on public.license_devices from anon, authenticated;

-- =====================================================================================
-- refund_events
-- =====================================================================================

create table if not exists public.refund_events (
  id uuid primary key default gen_random_uuid(),
  -- Lowercased, trimmed buyer email from the Lemon Squeezy order or invoice.
  email text not null,
  -- Lemon order id, or invoice:<id> for a subscription invoice refund (no order id on that object).
  order_id text not null,
  refunded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint refund_events_email_normalized check (
    email = lower(btrim(email))
    and position('@' in email) > 1
  ),
  constraint refund_events_order_id_unique unique (order_id)
);

create index if not exists refund_events_email_refunded_at_idx
  on public.refund_events (email, refunded_at desc);

alter table public.refund_events enable row level security;
alter table public.refund_events force row level security;

revoke all on public.refund_events from anon, authenticated;

-- Platform admins: app_metadata.role = 'admin' (not user_metadata). service_role bypasses RLS.
create or replace function public.is_billing_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

revoke all on function public.is_billing_admin() from public, anon;
grant execute on function public.is_billing_admin() to authenticated, service_role;

-- One row per order or subscription invoice. A later refund on the same id keeps the later time.
create or replace function public.record_refund_event(
  p_email text,
  p_order_id text,
  p_refunded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null
     or p_email <> lower(btrim(p_email))
     or position('@' in p_email) < 2
     or p_order_id is null
     or btrim(p_order_id) = ''
     or p_refunded_at is null then
    raise exception 'refund event requires a normalized email, order id, and refund time';
  end if;

  insert into public.refund_events (email, order_id, refunded_at)
  values (p_email, p_order_id, p_refunded_at)
  on conflict (order_id) do update
  set
    email = excluded.email,
    refunded_at = greatest(public.refund_events.refunded_at, excluded.refunded_at);
end;
$$;

revoke all on function public.record_refund_event(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_refund_event(text, text, timestamptz) to service_role;

grant select on public.refund_events to authenticated, service_role;

drop policy if exists "refund_events_select_admin" on public.refund_events;
create policy "refund_events_select_admin" on public.refund_events
  for select to authenticated
  using ((select public.is_billing_admin()));

-- Emails with 2+ refunds. security_invoker so RLS on refund_events applies.
create or replace view public.admin_repeat_refunders
with (security_invoker = true) as
select
  email,
  count(*)::bigint as refund_count,
  max(refunded_at) as last_refund_at
from public.refund_events
group by email
having count(*) >= 2;

comment on view public.admin_repeat_refunders is
  'Buyer emails with two or more refund events, and the latest refund time. A person decides what to do. Purchases are not blocked.';

revoke all on public.admin_repeat_refunders from public, anon, authenticated;
grant select on public.admin_repeat_refunders to authenticated, service_role;

-- =====================================================================================
-- Webhook helpers (service_role only)
-- =====================================================================================

create or replace function public.deactivate_license_for_refund(
  p_order_id text,
  p_subscription_id text,
  p_refunded_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.license_keys
  set
    status = 'disabled',
    ends_at = case
      when ends_at is null then p_refunded_at
      when ends_at > p_refunded_at then p_refunded_at
      else ends_at
    end,
    updated_at = now()
  where (
      status is distinct from 'disabled'
      or ends_at is null
      or ends_at > p_refunded_at
    )
    and (
      (p_order_id is not null and order_id = p_order_id)
      or (p_subscription_id is not null and subscription_id = p_subscription_id)
    );
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.deactivate_license_for_refund(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.deactivate_license_for_refund(text, text, timestamptz) to service_role;

create or replace function public.upsert_license_key(
  p_lemon_id text,
  p_license_key text,
  p_order_id text,
  p_status text,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text := p_status;
begin
  if p_lemon_id is null or btrim(p_lemon_id) = '' or p_license_key is null or btrim(p_license_key) = '' then
    return;
  end if;
  if next_status not in ('active', 'disabled') then
    next_status := 'active';
  end if;

  insert into public.license_keys (lemon_id, license_key, order_id, status, ends_at)
  values (p_lemon_id, p_license_key, nullif(btrim(p_order_id), ''), next_status, p_ends_at)
  on conflict (lemon_id) do update
  set
    license_key = excluded.license_key,
    order_id = coalesce(excluded.order_id, public.license_keys.order_id),
    status = case
      when public.license_keys.status = 'disabled' then 'disabled'
      else excluded.status
    end,
    ends_at = case
      when public.license_keys.ends_at is null then excluded.ends_at
      when excluded.ends_at is null then public.license_keys.ends_at
      else least(public.license_keys.ends_at, excluded.ends_at)
    end,
    updated_at = now();
end;
$$;

revoke all on function public.upsert_license_key(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_license_key(text, text, text, text, timestamptz) to service_role;

create or replace function public.link_license_subscription(
  p_order_id text,
  p_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_order_id is null or btrim(p_order_id) = '' or p_subscription_id is null or btrim(p_subscription_id) = '' then
    return;
  end if;
  update public.license_keys
  set subscription_id = p_subscription_id, updated_at = now()
  where order_id = p_order_id
    and subscription_id is distinct from p_subscription_id;
end;
$$;

revoke all on function public.link_license_subscription(text, text) from public, anon, authenticated;
grant execute on function public.link_license_subscription(text, text) to service_role;

-- =====================================================================================
-- Retention
-- =====================================================================================

create or replace function public.purge_billing_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  devices_deleted bigint;
  keys_deleted bigint;
  refunds_deleted bigint;
begin
  delete from public.license_devices as device
  using public.license_keys as license
  where device.license_key_id = license.id
    and license.ends_at is not null
    and license.ends_at <= now() - interval '1 year';
  get diagnostics devices_deleted = row_count;

  delete from public.license_keys
  where ends_at is not null
    and ends_at <= now() - interval '1 year';
  get diagnostics keys_deleted = row_count;

  delete from public.refund_events
  where email in (
    select email
    from public.refund_events
    group by email
    having max(refunded_at) <= now() - interval '3 years'
  );
  get diagnostics refunds_deleted = row_count;

  return jsonb_build_object(
    'license_devices_deleted', devices_deleted,
    'license_keys_deleted', keys_deleted,
    'refund_events_deleted', refunds_deleted
  );
end;
$$;

comment on function public.purge_billing_retention() is
  'Daily retention: delete license key and device rows 1 year after ends_at; delete refund email rows 3 years after that email''s last refund. See supabase/README.md.';

revoke all on function public.purge_billing_retention() from public, anon, authenticated;
grant execute on function public.purge_billing_retention() to service_role;

-- pg_cron is available on this project and was not installed yet. Enable it here.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  existing_id bigint;
begin
  select jobid into existing_id from cron.job where jobname = 'billing-retention-cleanup';
  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;
  perform cron.schedule(
    'billing-retention-cleanup',
    '0 18 * * *',
    'select public.purge_billing_retention()'
  );
end
$$;
