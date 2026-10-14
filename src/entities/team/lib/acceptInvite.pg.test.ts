import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("accept_workspace_invite on local Postgres", () => {
  it("lets a shareable-token outsider join as the invite role and rejects a mismatched email", () => {
    const output = execFileSync(process.execPath, ["scripts/accept-invite-pg-test.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("PASS accept_workspace_invite");
    expect(output).toContain("shareable outsider joins: admin");
    expect(output).toContain("email mismatch: invite not found");
    expect(output).toContain("email match joins: member");
  });
});
