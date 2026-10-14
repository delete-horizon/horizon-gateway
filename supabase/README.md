# Local Supabase (Horizon Gateway)

Schema SSOT: [`migrations/`](./migrations/). Do not change tables/RLS in the dashboard.

## Prerequisites

- Docker Desktop running
- Supabase CLI via `npx supabase` (or a global install)

## Daily drive

From the **workspace root**:

```bash
pnpm dev:gateway:tauri
```

That runs gateway `scripts/tauri-env.mjs`. When `VITE_SUPABASE_URL` is `http://127.0.0.1:54321` (or localhost), it:

1. `supabase start` (no-op if already up)
2. Injects anon key into `.env.supabase.local` (gitignored)
3. Upserts the env user (`VITE_DEV_LOCAL_*`) via service role
4. Starts Tauri + Vite; the app `signInWithPassword`s as that user

From this package:

```bash
pnpm tauri dev
pnpm supabase:ensure
pnpm supabase:status
pnpm supabase:reset   # wipe local DB + re-apply migrations + seed.sql
pnpm supabase:types   # regenerate src/shared/api/database.types.ts from --local
```

## Env (`.env`, gitignored)

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
# VITE_SUPABASE_ANON_KEY optional — ensure script overwrites via .env.supabase.local

VITE_DEV_LOCAL_EMAIL=dev@localhost
VITE_DEV_LOCAL_PASSWORD=dev-password-change-me
VITE_DEV_LOCAL_DISPLAY_NAME=Local Dev
VITE_DEV_LOCAL_GITHUB_LOGIN=local-dev
VITE_DEV_LOCAL_TEAM_ENTITLEMENT=unlimited
```

Cloud URL → ensure is skipped (release / cloud debug unchanged).

## Prod / local parity

| Concern | Rule |
| --- | --- |
| Schema / RLS | Only `migrations/*.sql`. Local `db reset` + remote `supabase db push` (linked project). |
| Check drift | `npx supabase migration list` — local and remote versions should match after push. |
| Types | `pnpm supabase:types` after schema changes; commit `database.types.ts`. |
| Test user / entitlement | Local: env + ensure. Prod: real account / webhooks. **Do not** add personal UID `UPDATE`s in new migrations. |
| Dashboard edits | Forbidden for schema/RLS (primary drift source). |

### Known intentional differences

- **Auth**: local email/password auto-login vs prod GitHub OAuth + `horizon-gateway://` deep link.
- **Edge functions** (lemon / sponsors / checkout): not started locally — billing/sponsor flows are cloud-only.
- **`config.toml` `site_url`**: local Vite (`http://localhost:1420`).

## Billing retention

Lemon Squeezy refund webhooks (`order_refunded`, `subscription_payment_refunded`) insert `refund_events` and call `deactivate_license_for_refund`, which sets the matching `license_keys` row to `disabled` and sets `ends_at` to the refund time when that is earlier than the current end. That does not block a later purchase. `admin_repeat_refunders` lists emails with two or more refunds for a person to review. It is readable by `service_role` and by authenticated users whose `app_metadata.role` is `admin` (RLS, `security_invoker`).

`public.purge_billing_retention()` is the retention job. It matches the published privacy policy at <https://gateway.delete-horizon.com/privacy>:

| Data | When it is deleted |
| --- | --- |
| License key row, and its per-install device id rows (including the app version stored on the device row) | 1 year after the license ends (`license_keys.ends_at`) |
| Refund email rows for one buyer | 3 years after that email's last refund |

The license server is Supabase in Seoul (`ap-northeast-2`). Lemon Squeezy is the Merchant of Record and processes checkout in the United States. Card data stays with Lemon Squeezy.

pg_cron was not installed on the project. Migration `20261014031727_refund_events_and_retention.sql` enables `pg_cron` and schedules `billing-retention-cleanup` daily at 18:00 UTC (03:00 Asia/Seoul):

```sql
select public.purge_billing_retention();
```

The job is idempotent: re-applying the migration unschedules and recreates that job name. Run the migration before deploying `lemon-squeezy-webhook`, or refund inserts fail.

## Historical note

`20260806000001_team_entitlement.sql` still contains a one-time prod UID grant. Left for remote history; do not copy that pattern.
