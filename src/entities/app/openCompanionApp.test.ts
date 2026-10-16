import { beforeEach, describe, expect, it, vi } from "vitest";

const openWorkspaceApp = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ status: "ok" as string, data: null as null, error: "" })),
);
const logClientFailure = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));

vi.mock("@/shared/api", () => ({
  commands: { openWorkspaceApp },
  unwrap: (result: { status: string }) => result,
}));
vi.mock("@/shared/lib/appLog", () => ({ logClientFailure }));
vi.mock("./sessionHandoff", () => ({
  putSessionHandoff: vi.fn(async () => undefined),
}));

import { openWorkspaceCompanion } from "./openCompanionApp";

describe("openWorkspaceCompanion", () => {
  beforeEach(() => {
    openWorkspaceApp.mockReset();
    logClientFailure.mockClear();
  });

  it("logs a reason code when the Team window cannot be spawned", async () => {
    openWorkspaceApp.mockResolvedValueOnce({
      status: "error",
      data: null,
      error: "failed to spawn /secret/horizon-gateway-workspace",
    });
    await expect(openWorkspaceCompanion()).resolves.toContain("failed to spawn");
    expect(logClientFailure).toHaveBeenCalledWith({
      function: "open-workspace",
      reason: "spawn_failed",
      status: null,
      workspaceId: null,
    });
    expect(JSON.stringify(logClientFailure.mock.calls)).not.toContain("horizon-gateway-workspace");
  });
});
