// Supabase Edge Function (Deno): Lemon Squeezy subscription webhook receiver.
//
// Verifies the Lemon Squeezy webhook signature, records the raw body in
// `webhook_events` (sha256 hex id) so a replay returns 200 without reprocessing,
// then updates workspace billing columns. The workspace id is honored only when
// `meta.custom_data.workspace_sig` is an HMAC of that id made with the webhook
// secret (see create-checkout). Unsigned custom data is ignored.
// `order_refunded` and `subscription_payment_refunded` also record
// `refund_events` and deactivate the matching license key. If processing after
// the insert fails, the event row is deleted so a retry is processed again.
//
// Refunds do not block future purchases. Repeat refunders are listed in
// `admin_repeat_refunders` for a person to review.
//
// Unknown subscription statuses do not grant an active plan.
//
// Apply the billing RLS migration and the refund_events migration before
// deploying this function. Gateway JWT verification is disabled (config.toml);
// Lemon cannot send a Supabase JWT. This handler requires a valid HMAC instead.
//
// Lemon Squeezy webhook setup: Store settings -> Webhooks
//   - URL: https://<project-ref>.supabase.co/functions/v1/lemon-squeezy-webhook
//   - Events: subscription_created, subscription_updated, subscription_cancelled,
//             subscription_expired, subscription_resumed, subscription_paused,
//             order_refunded, subscription_payment_refunded, license_key_created,
//             license_key_updated
//
// Required secrets:
//   - LEMON_SQUEEZY_WEBHOOK_SECRET
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleLemonSqueezyWebhook, type WebhookSupabase } from "./handler.ts";

const LEMON_SQUEEZY_WEBHOOK_SECRET = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handleLemonSqueezyWebhook(req, {
    supabase: supabase as unknown as WebhookSupabase,
    webhookSecret: LEMON_SQUEEZY_WEBHOOK_SECRET,
  }),
);
