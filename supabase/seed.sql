-- Local/dev seed data only (applied on `supabase db reset`).
-- Auth users are created by scripts/ensure-supabase-local.mjs from env
-- (VITE_DEV_LOCAL_EMAIL / PASSWORD) — do not hardcode passwords here.
-- Schema/RLS belongs in migrations/, never in this file.

select 1;
