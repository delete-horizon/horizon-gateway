-- Idempotency store for lemon-squeezy-webhook (service_role only; RLS on, no policies).
create table if not exists public.webhook_events (
  id text primary key,            -- sha256 hex of the raw signed body
  event_name text not null,
  received_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
