import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const isTauri = vi.hoisted(() => vi.fn(() => true));

vi.mock("@tauri-apps/api/core", () => ({ isTauri }));
vi.mock("@/shared/lib/tauri/client", () => ({ invoke }));

import { logClientFailure } from "./appLog";

describe("logClientFailure", () => {
  beforeEach(() => {
    invoke.mockClear();
    isTauri.mockReturnValue(true);
  });

  it("writes a reason code, status, and workspace id", async () => {
    await logClientFailure({
      function: "create-checkout",
      reason: "unauthorized",
      status: 401,
      workspaceId: "142b1dfb-cae3-4c56-b5c7-54a3b4036b37",
    });
    expect(invoke).toHaveBeenCalledWith("log_client_failure", {
      function: "create-checkout",
      reason: "unauthorized",
      status: 401,
      workspaceId: "142b1dfb-cae3-4c56-b5c7-54a3b4036b37",
    });
  });

  it("drops emails, tokens, and non-uuid workspace ids before invoke", async () => {
    await logClientFailure({
      function: "create-checkout",
      reason: "user@example.com Bearer eyJhbGci.sig.sig",
      status: 500,
      workspaceId: "not-a-uuid",
    });
    const payload = invoke.mock.calls[0]?.[1] as { reason: string; workspaceId: string | null } | undefined;
    expect(payload?.reason).toBe("invalid");
    expect(payload?.workspaceId).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("@");
    expect(JSON.stringify(payload)).not.toContain("eyJ");
  });
});
