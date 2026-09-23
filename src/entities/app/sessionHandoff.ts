import { commands, unwrap } from "@/shared/api";

/** Companion shell (`/comm` or `?sessionHandoff=1`) adopts Hub's login. Hub itself does not. */
export function shouldConsumeSessionHandoff(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("sessionHandoff") === "1") {
    return true;
  }
  return window.location.pathname.startsWith("/comm");
}

export async function putSessionHandoff(accessToken: string, refreshToken: string): Promise<void> {
  try {
    unwrap(await commands.sessionHandoffPut(accessToken, refreshToken));
  } catch (error) {
    console.warn("[session-handoff] put failed", error);
  }
}

export async function takeSessionHandoff(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const data = unwrap(await commands.sessionHandoffTake());
  if (!data?.accessToken || !data.refreshToken) {
    return null;
  }
  return data;
}
