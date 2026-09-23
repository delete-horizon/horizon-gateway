import { supabase } from "@/shared/api/supabase";

function envString(key: keyof ImportMetaEnv, fallback = ""): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/** True when the Vite-injected Supabase URL points at the local CLI stack. */
export function isLocalSupabaseUrl(url = import.meta.env.VITE_SUPABASE_URL || ""): boolean {
  if (!url) {
    return false;
  }
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * Local stack auto-login via email/password from env.
 * Only active in Vite DEV against a local Supabase URL.
 */
export function isDevLocalPasswordAuthEnabled(): boolean {
  if (import.meta.env.DEV !== true || !isLocalSupabaseUrl()) {
    return false;
  }
  return Boolean(envString("VITE_DEV_LOCAL_EMAIL") && envString("VITE_DEV_LOCAL_PASSWORD"));
}

/**
 * Sign in as the ensure-script user. Returns an error message or null on success.
 */
export async function signInDevLocalUser(): Promise<string | null> {
  const email = envString("VITE_DEV_LOCAL_EMAIL");
  const password = envString("VITE_DEV_LOCAL_PASSWORD");
  if (!email || !password) {
    return "VITE_DEV_LOCAL_EMAIL / VITE_DEV_LOCAL_PASSWORD missing";
  }

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user?.email?.toLowerCase() === email.toLowerCase()) {
    console.info("[dev] local password session already active", existing.session.user.id);
    return null;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return error.message;
  }
  console.info("[dev] local password sign-in ok", data.user?.id);
  return null;
}
