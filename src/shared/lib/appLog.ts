import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@/shared/lib/tauri/client";

const REASON = /^[a-z0-9_-]{1,40}$/;
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClientFailure {
  function: string;
  reason: string;
  status?: number | null;
  workspaceId?: string | null;
}

/** Structured failure for the local app log. Drops anything that is not a reason code or workspace id. */
export async function logClientFailure(input: ClientFailure): Promise<void> {
  const functionName = REASON.test(input.function) ? input.function : "invalid";
  const reason = REASON.test(input.reason) ? input.reason : "invalid";
  const status = typeof input.status === "number" && input.status >= 100 && input.status <= 599 ? input.status : null;
  const workspaceId = input.workspaceId && WORKSPACE_ID.test(input.workspaceId) ? input.workspaceId : null;
  console.warn("client failure", { function: functionName, reason, status, workspaceId });
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("log_client_failure", {
      function: functionName,
      reason,
      status,
      workspaceId,
    });
  } catch {
    // A log write must not block checkout or opening Team.
  }
}
