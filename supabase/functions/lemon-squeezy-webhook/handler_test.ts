import { signWorkspaceId } from "../_shared/checkoutRequest.ts";
import {
  handleLemonSqueezyWebhook,
  LEGACY_UNSIGNED_CUTOFF,
  resolveLegacyUnsignedCutoff,
  SEAT_LIMIT_BY_VARIANT,
  type WebhookSupabase,
} from "./handler.ts";

const SECRET = "test-webhook-secret";
const PRO_VARIANT_ID = "1987632";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const BEFORE_CUTOFF = "2099-01-01T00:00:00Z";
const AFTER_CUTOFF = "2020-01-01T00:00:00Z";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
  column: string;
  value: string;
}

interface RecordedDelete {
  table: string;
  column: string;
  value: string;
}

interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

interface MockOptions {
  /** Number of workspace updates that return an error before later calls succeed. */
  failUpdates?: number;
  updateThrows?: boolean;
  /** Number of rpc calls that return an error before later calls succeed. */
  failRpcs?: number;
  /** Workspace update row count. `0` means the id matched nothing. */
  updateCount?: number;
}

function createMock(options: MockOptions = {}) {
  const events = new Map<string, string>();
  const updates: RecordedUpdate[] = [];
  const deletes: RecordedDelete[] = [];
  const rpcs: RecordedRpc[] = [];
  let updateFailuresLeft = options.failUpdates ?? 0;
  let rpcFailuresLeft = options.failRpcs ?? 0;

  const supabase: WebhookSupabase = {
    from(table: string) {
      return {
        insert(row: { id: string; event_name: string }) {
          if (events.has(row.id)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            });
          }
          events.set(row.id, row.event_name);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(column: string, value: string) {
              deletes.push({ table, column, value });
              if (column === "id") {
                events.delete(value);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        update(values: Record<string, unknown>, _options?: { count?: "exact" }) {
          return {
            eq(column: string, value: string) {
              if (options.updateThrows) {
                return Promise.reject(new Error("workspaces update exploded"));
              }
              updates.push({ table, values, column, value });
              if (updateFailuresLeft > 0) {
                updateFailuresLeft -= 1;
                return Promise.resolve({ error: { message: "db down" }, count: null });
              }
              return Promise.resolve({ error: null, count: options.updateCount ?? 1 });
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (rpcFailuresLeft > 0) {
        rpcFailuresLeft -= 1;
        return Promise.resolve({ error: { message: "rpc down" } });
      }
      return Promise.resolve({ error: null });
    },
  };

  return { supabase, events, updates, deletes, rpcs };
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`expected ${expectedJson} but got ${actualJson}`);
  }
}

function captureWarnings(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
  };
  return {
    text: () => lines.join("\n"),
    restore: () => {
      console.warn = original;
    },
  };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(mac);
}

function post(body: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) {
    headers.set("x-signature", signature);
  }
  return new Request("https://example.test/functions/v1/lemon-squeezy-webhook", {
    method: "POST",
    headers,
    body,
  });
}

async function subscriptionBody(input: {
  event: string;
  status: string;
  variantId?: number | string;
  workspaceId?: string;
  subscriptionId?: string;
  signWorkspace?: boolean;
}): Promise<string> {
  const workspaceId = input.workspaceId ?? WORKSPACE_ID;
  const workspaceSig = input.signWorkspace === false ? undefined : await signWorkspaceId(SECRET, workspaceId);
  return JSON.stringify({
    meta: {
      event_name: input.event,
      custom_data: {
        workspace_id: workspaceId,
        ...(workspaceSig ? { workspace_sig: workspaceSig } : {}),
      },
    },
    data: {
      id: input.subscriptionId ?? "sub-1",
      attributes: {
        status: input.status,
        ...(input.variantId !== undefined ? { variant_id: input.variantId } : {}),
      },
    },
  });
}

Deno.test("valid signature returns 200", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(mock.updates.length, 1);
});

Deno.test("invalid signature returns 401 and does not record the event", async () => {
  const mock = createMock();
  const body = await subscriptionBody({ event: "subscription_created", status: "active", variantId: Number(PRO_VARIANT_ID) });
  const response = await handleLemonSqueezyWebhook(post(body, "0".repeat(64)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 401);
  assertEquals(await response.text(), "invalid signature");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.updates.length, 0);
});

Deno.test("missing signature returns 401 and does not record the event", async () => {
  const mock = createMock();
  const body = await subscriptionBody({ event: "subscription_created", status: "active", variantId: Number(PRO_VARIANT_ID) });
  const response = await handleLemonSqueezyWebhook(post(body, null), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 401);
  assertEquals(await response.text(), "invalid signature");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.updates.length, 0);
});

Deno.test("duplicate event id is ignored", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    subscriptionId: "sub-dup",
  });
  const signature = await sign(body);
  const deps = { supabase: mock.supabase, webhookSecret: SECRET };

  const first = await handleLemonSqueezyWebhook(post(body, signature), deps);
  const second = await handleLemonSqueezyWebhook(post(body, signature), deps);

  assertEquals(first.status, 200);
  assertEquals(await first.text(), "ok");
  assertEquals(second.status, 200);
  assertEquals(await second.text(), "duplicate");
  assertEquals(mock.updates.length, 1);
  assertEquals(mock.events.size, 1);
  assertEquals(mock.deletes.length, 0);
});

Deno.test("subscription_created sets plan pro and seat_limit from SEAT_LIMIT_BY_VARIANT", async () => {
  const variantSeats = SEAT_LIMIT_BY_VARIANT[PRO_VARIANT_ID];
  assertEquals(variantSeats, 5);

  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    workspaceId: "22222222-2222-4222-8222-222222222222",
    subscriptionId: "sub-pro",
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(mock.updates.length, 1);
  const update = mock.updates[0];
  assertEquals(update.table, "workspaces");
  assertEquals(update.column, "id");
  assertEquals(update.value, "22222222-2222-4222-8222-222222222222");
  assertEquals(update.values, {
    status: "active",
    plan: "pro",
    seat_limit: variantSeats,
    ls_subscription_id: "sub-pro",
  });
});

Deno.test("cancel and expire return plan free and seat_limit 3", async () => {
  const cases = [
    { event: "subscription_cancelled", status: "cancelled", subscriptionId: "sub-cancel" },
    { event: "subscription_expired", status: "expired", subscriptionId: "sub-expire" },
  ];

  for (const item of cases) {
    const mock = createMock();
    const body = await subscriptionBody({
      event: item.event,
      status: item.status,
      variantId: Number(PRO_VARIANT_ID),
      workspaceId: "33333333-3333-4333-8333-333333333333",
      subscriptionId: item.subscriptionId,
    });
    const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
      supabase: mock.supabase,
      webhookSecret: SECRET,
    });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
    assertEquals(mock.updates.length, 1);
    assertEquals(mock.updates[0].values, {
      status: "canceled",
      plan: "free",
      seat_limit: 3,
      ls_subscription_id: null,
    });
  }
});

Deno.test("workspace update failure clears the dedupe record so the retry is processed", async () => {
  const mock = createMock({ failUpdates: 1 });
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    subscriptionId: "sub-retry",
  });
  const signature = await sign(body);
  const deps = { supabase: mock.supabase, webhookSecret: SECRET };

  const failed = await handleLemonSqueezyWebhook(post(body, signature), deps);
  assertEquals(failed.status, 500);
  assertEquals(await failed.text(), "update failed");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.deletes.length, 1);
  assertEquals(mock.deletes[0].table, "webhook_events");
  assertEquals(mock.deletes[0].column, "id");

  const retried = await handleLemonSqueezyWebhook(post(body, signature), deps);
  assertEquals(retried.status, 200);
  assertEquals(await retried.text(), "ok");
  assertEquals(mock.events.size, 1);
  assertEquals(mock.updates.length, 2);
  assertEquals(mock.updates[1].values.plan, "pro");
  assertEquals(mock.updates[1].values.seat_limit, SEAT_LIMIT_BY_VARIANT[PRO_VARIANT_ID]);
});

Deno.test("processing exception clears the dedupe record", async () => {
  const mock = createMock({ updateThrows: true });
  const body = await subscriptionBody({
    event: "subscription_updated",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "processing failed");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.deletes.length, 1);
  assertEquals(mock.deletes[0].table, "webhook_events");
  assertEquals(mock.deletes[0].column, "id");
});

Deno.test("subscription_created does not record a refund or touch a license key", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(mock.rpcs.length, 0);
  assertEquals(mock.updates.length, 1);
  assertEquals(mock.updates[0].values.plan, "pro");
  assertEquals(mock.updates[0].values.seat_limit, 5);
});

Deno.test("unsigned workspace binding after the cutoff is ignored and does not grant a plan", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    signWorkspace: false,
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: AFTER_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(mock.deletes.length, 0);
  assertEquals(mock.events.size, 1);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("unknown subscription status does not grant an active plan", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_updated",
    status: "complimentary",
    variantId: Number(PRO_VARIANT_ID),
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(mock.deletes.length, 0);
});

Deno.test("a zero-row workspace update releases the dedupe record", async () => {
  const mock = createMock({ updateCount: 0 });
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "update failed");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.deletes.length, 1);
});

Deno.test("order_refunded records the buyer email and deactivates the license key", async () => {
  const mock = createMock();
  const body = JSON.stringify({
    meta: { event_name: "order_refunded", custom_data: { workspace_id: "ws-1" } },
    data: {
      id: "42",
      attributes: {
        user_email: "  Buyer@Example.COM ",
        refunded_at: "2026-10-01T12:00:00.000000Z",
        status: "refunded",
      },
    },
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(mock.updates.length, 0);
  assertEquals(mock.rpcs.map((call) => call.fn), ["record_refund_event", "deactivate_license_for_refund"]);
  assertEquals(mock.rpcs[0].args, {
    p_email: "buyer@example.com",
    p_order_id: "42",
    p_refunded_at: "2026-10-01T12:00:00.000Z",
  });
  assertEquals(mock.rpcs[1].args, {
    p_order_id: "42",
    p_subscription_id: null,
    p_refunded_at: "2026-10-01T12:00:00.000Z",
  });
});

Deno.test("subscription_payment_refunded deactivates the key and still updates a bound workspace", async () => {
  const mock = createMock();
  const workspaceSig = await signWorkspaceId(SECRET, WORKSPACE_ID);
  const body = JSON.stringify({
    meta: {
      event_name: "subscription_payment_refunded",
      custom_data: { workspace_id: WORKSPACE_ID, workspace_sig: workspaceSig },
    },
    data: {
      id: "9",
      attributes: {
        status: "active",
        user_email: "sub@example.com",
        subscription_id: 77,
        refunded_at: "2026-10-02T00:00:00.000Z",
        variant_id: Number(PRO_VARIANT_ID),
      },
    },
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(mock.rpcs[0].fn, "record_refund_event");
  assertEquals(mock.rpcs[0].args.p_email, "sub@example.com");
  assertEquals(mock.rpcs[0].args.p_order_id, "invoice:9");
  assertEquals(mock.rpcs[1].args, {
    p_order_id: null,
    p_subscription_id: "77",
    p_refunded_at: "2026-10-02T00:00:00.000Z",
  });
  assertEquals(mock.updates.length, 1);
  assertEquals(mock.updates[0].value, WORKSPACE_ID);
  assertEquals(mock.updates[0].values, {
    status: "active",
    plan: "pro",
    seat_limit: 5,
    ls_subscription_id: "9",
  });
});

Deno.test("unsigned subscription refund still records the refund and does not grant a plan", async () => {
  const mock = createMock();
  const body = JSON.stringify({
    meta: { event_name: "subscription_payment_refunded", custom_data: { workspace_id: "ws-1" } },
    data: {
      id: "9",
      attributes: {
        status: "refunded",
        user_email: "sub@example.com",
        subscription_id: 77,
        refunded_at: "2026-10-02T00:00:00.000Z",
        variant_id: Number(PRO_VARIANT_ID),
      },
    },
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.rpcs.map((call) => call.fn), ["record_refund_event", "deactivate_license_for_refund"]);
  assertEquals(mock.updates.length, 0);
});

Deno.test("refund without a buyer email still deactivates the license key", async () => {
  const mock = createMock();
  const body = JSON.stringify({
    meta: { event_name: "order_refunded" },
    data: { id: "42", attributes: { refunded_at: "2026-10-01T12:00:00.000Z" } },
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });

  assertEquals(response.status, 200);
  assertEquals(mock.rpcs.map((call) => call.fn), ["deactivate_license_for_refund"]);
  assertEquals(mock.updates.length, 0);
});

Deno.test("refund insert failure clears the dedupe record so the retry is processed", async () => {
  const mock = createMock({ failRpcs: 1 });
  const body = JSON.stringify({
    meta: { event_name: "order_refunded" },
    data: {
      id: "42",
      attributes: { user_email: "buyer@example.com", refunded_at: "2026-10-01T12:00:00.000Z" },
    },
  });
  const signature = await sign(body);
  const deps = { supabase: mock.supabase, webhookSecret: SECRET };

  const failed = await handleLemonSqueezyWebhook(post(body, signature), deps);
  assertEquals(failed.status, 500);
  assertEquals(await failed.text(), "refund insert failed");
  assertEquals(mock.events.size, 0);
  assertEquals(mock.deletes.length, 1);
  assertEquals(mock.updates.length, 0);

  const retried = await handleLemonSqueezyWebhook(post(body, signature), deps);
  assertEquals(retried.status, 200);
  assertEquals(await retried.text(), "ok");
  assertEquals(mock.events.size, 1);
  assertEquals(mock.rpcs.filter((call) => call.fn === "deactivate_license_for_refund").length, 1);
});

Deno.test("ignored events do not echo the event name", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "order_created",
    status: "active",
  });
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
  });
  const text = await response.text();

  assertEquals(response.status, 200);
  assertEquals(text, "ignored");
  assertEquals(text.includes("order_created"), false);
  assertEquals(mock.updates.length, 0);
});

Deno.test("resolveLegacyUnsignedCutoff reads an ISO override and falls back to the constant", () => {
  assertEquals(LEGACY_UNSIGNED_CUTOFF, "2026-11-15T00:00:00Z");
  assertEquals(resolveLegacyUnsignedCutoff(undefined), Date.parse(LEGACY_UNSIGNED_CUTOFF));
  assertEquals(resolveLegacyUnsignedCutoff("  "), Date.parse(LEGACY_UNSIGNED_CUTOFF));
  assertEquals(resolveLegacyUnsignedCutoff("not-a-date"), Date.parse(LEGACY_UNSIGNED_CUTOFF));
  assertEquals(resolveLegacyUnsignedCutoff("2026-12-01T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z"));
});

Deno.test("signed workspace binding is accepted and does not log a legacy checkout", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(mock.updates.length, 1);
  assertEquals(mock.updates[0].values.plan, "pro");
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("a bad workspace_sig is rejected before the cutoff", async () => {
  const mock = createMock();
  const body = JSON.stringify({
    meta: {
      event_name: "subscription_created",
      custom_data: { workspace_id: WORKSPACE_ID, workspace_sig: "ab".repeat(32) },
    },
    data: {
      id: "sub-bad-sig",
      attributes: { status: "active", variant_id: Number(PRO_VARIANT_ID) },
    },
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("unsigned checkout before the cutoff grants pro and logs legacy_unsigned_checkout", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    signWorkspace: false,
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(mock.updates.length, 1);
  assertEquals(mock.updates[0].value, WORKSPACE_ID);
  assertEquals(mock.updates[0].values, {
    status: "active",
    plan: "pro",
    seat_limit: 5,
    ls_subscription_id: "sub-1",
  });
  const logged = warnings
    .text()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .find((line) => isLegacyLog(line));
  assertEquals(logged, {
    msg: "legacy_unsigned_checkout",
    workspace_id: WORKSPACE_ID,
    event_name: "subscription_created",
  });
});

Deno.test("unsigned checkout after the cutoff is rejected", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_updated",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    signWorkspace: false,
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: AFTER_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("unsigned non-uuid workspace id is rejected before the cutoff", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    workspaceId: "ws-1",
    signWorkspace: false,
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("unsigned cancellation before the cutoff does not change the plan", async () => {
  const mock = createMock();
  const body = await subscriptionBody({
    event: "subscription_cancelled",
    status: "cancelled",
    variantId: Number(PRO_VARIANT_ID),
    signWorkspace: false,
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.updates.length, 0);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

Deno.test("unsigned refund before the cutoff still records the refund and does not grant a plan", async () => {
  const mock = createMock();
  const body = JSON.stringify({
    meta: {
      event_name: "subscription_payment_refunded",
      custom_data: { workspace_id: WORKSPACE_ID },
    },
    data: {
      id: "9",
      attributes: {
        status: "active",
        user_email: "sub@example.com",
        subscription_id: 77,
        refunded_at: "2026-10-02T00:00:00.000Z",
        variant_id: Number(PRO_VARIANT_ID),
      },
    },
  });
  const warnings = captureWarnings();
  const response = await handleLemonSqueezyWebhook(post(body, await sign(body)), {
    supabase: mock.supabase,
    webhookSecret: SECRET,
    legacyUnsignedCutoff: BEFORE_CUTOFF,
  });
  warnings.restore();

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ignored");
  assertEquals(mock.rpcs.map((call) => call.fn), ["record_refund_event", "deactivate_license_for_refund"]);
  assertEquals(mock.updates.length, 0);
  assertEquals(warnings.text().includes("legacy_unsigned_checkout"), false);
});

function isLegacyLog(value: unknown): value is { msg: string; workspace_id: string; event_name: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "msg" in value && (value as { msg?: unknown }).msg === "legacy_unsigned_checkout";
}
