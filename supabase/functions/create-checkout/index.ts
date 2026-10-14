// Supabase Edge Function (Deno): signed Lemon Squeezy checkout URL for a workspace.
//
// Production clients must call this function. The URL includes
// `checkout[custom][workspace_sig]`, an HMAC of the workspace id, which
// lemon-squeezy-webhook requires before it changes billing columns.
// verify_jwt is also enabled in config.toml. This handler checks the user
// again so a deploy that skips gateway JWT verification still rejects
// anonymous callers.
//
// Required secrets (set via `supabase secrets set`):
//   - LEMON_SQUEEZY_CHECKOUT_URL — https://<store>.lemonsqueezy.com/checkout/buy/<variant>
//   - LEMON_SQUEEZY_WEBHOOK_SECRET — same secret the webhook uses to verify signatures
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected by the Edge runtime.
// This function does not read the service role key.
//
// Apply the billing RLS migration before deploying this function.
// Request body: { "workspace_id": "<uuid>", "email"?: "<string>" }
// Response body: { "url": "<checkout-url>" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appendCheckoutParams, isCheckoutEmail, isUuid, signWorkspaceId } from "../_shared/checkoutRequest.ts";
import { isRecord } from "../_shared/guards.ts";

const CHECKOUT_URL = Deno.env.get("LEMON_SQUEEZY_CHECKOUT_URL") ?? "";
const BINDING_SECRET = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

function json(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return json({ error: "invalid request" }, 400);
  }

  if (!CHECKOUT_URL || !BINDING_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("create-checkout is missing server configuration");
    return json({ error: "checkout is unavailable" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }
  if (!isRecord(payload) || !isUuid(payload.workspace_id)) {
    return json({ error: "invalid request" }, 400);
  }
  if (payload.email !== undefined && !isCheckoutEmail(payload.email)) {
    return json({ error: "invalid request" }, 400);
  }

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_workspace_admin", {
    ws_id: payload.workspace_id,
  });
  if (adminError) {
    console.error("create-checkout admin check failed");
    return json({ error: "checkout is unavailable" }, 500);
  }
  if (isAdmin !== true) {
    return json({ error: "forbidden" }, 403);
  }

  const { error: rateError } = await userClient.rpc("consume_user_rate_limit", {
    action: "create_checkout",
  });
  if (rateError) {
    const message = rateError.message.toLowerCase();
    if (message.includes("rate limit")) {
      return json({ error: "too many requests" }, 429);
    }
    console.error("create-checkout rate limit failed");
    return json({ error: "checkout is unavailable" }, 500);
  }

  const workspaceSig = await signWorkspaceId(BINDING_SECRET, payload.workspace_id);
  if (!workspaceSig) {
    return json({ error: "checkout is unavailable" }, 500);
  }

  const params: Record<string, string> = {
    "checkout[custom][workspace_id]": payload.workspace_id,
    "checkout[custom][workspace_sig]": workspaceSig,
  };
  if (typeof payload.email === "string") {
    params["checkout[email]"] = payload.email;
  }

  const url = appendCheckoutParams(CHECKOUT_URL, params);
  if (!url) {
    console.error("create-checkout base URL was rejected");
    return json({ error: "checkout is unavailable" }, 500);
  }

  return json({ url }, 200);
});
