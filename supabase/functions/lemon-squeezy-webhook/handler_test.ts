import { handleLemonSqueezyWebhook, SEAT_LIMIT_BY_VARIANT, type WebhookSupabase } from "./handler.ts";

const SECRET = "test-webhook-secret";
const PRO_VARIANT_ID = "1987632";

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
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              if (options.updateThrows) {
                return Promise.reject(new Error("workspaces update exploded"));
              }
              updates.push({ table, values, column, value });
              if (updateFailuresLeft > 0) {
                updateFailuresLeft -= 1;
                return Promise.resolve({ error: { message: "db down" } });
              }
              return Promise.resolve({ error: null });
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

function subscriptionBody(input: {
  event: string;
  status: string;
  variantId?: number | string;
  workspaceId?: string;
  subscriptionId?: string;
}): string {
  return JSON.stringify({
    meta: {
      event_name: input.event,
      custom_data: { workspace_id: input.workspaceId ?? "ws-1" },
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
  const body = subscriptionBody({
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
  const body = subscriptionBody({ event: "subscription_created", status: "active", variantId: Number(PRO_VARIANT_ID) });
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
  const body = subscriptionBody({ event: "subscription_created", status: "active", variantId: Number(PRO_VARIANT_ID) });
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
  const body = subscriptionBody({
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
  const body = subscriptionBody({
    event: "subscription_created",
    status: "active",
    variantId: Number(PRO_VARIANT_ID),
    workspaceId: "ws-pro",
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
  assertEquals(update.value, "ws-pro");
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
    const body = subscriptionBody({
      event: item.event,
      status: item.status,
      variantId: Number(PRO_VARIANT_ID),
      workspaceId: "ws-free",
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
  const body = subscriptionBody({
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
  const body = subscriptionBody({
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
  const body = subscriptionBody({
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

Deno.test("subscription_payment_refunded deactivates the key and still updates the workspace", async () => {
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
  assertEquals(mock.updates[0].values, {
    status: "active",
    plan: "pro",
    seat_limit: 5,
    ls_subscription_id: "9",
  });
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
