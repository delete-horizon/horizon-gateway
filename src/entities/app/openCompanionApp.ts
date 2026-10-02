import { getDefaultStore } from "jotai";
import { commands } from "@/shared/api";
import { putSessionHandoff } from "./sessionHandoff";
import { supabaseSessionAtom } from "./user/store";

export type CommTab = "workspaces" | "resources" | "chat" | "character" | "avatar";

/** Focus the Comm companion, spawning it when it is not running. */
export async function openWorkspaceCompanion(tab?: CommTab): Promise<string | null> {
  const session = getDefaultStore().get(supabaseSessionAtom);
  if (session?.access_token && session.refresh_token) {
    await putSessionHandoff(session.access_token, session.refresh_token);
  }
  const result = await commands.openWorkspaceApp(tab ?? null);
  return result.status === "error" ? result.error : null;
}

/** Focus the Hub window, spawning it when it is not running. */
export async function openHubApp(): Promise<string | null> {
  const result = await commands.openHubApp();
  return result.status === "error" ? result.error : null;
}
