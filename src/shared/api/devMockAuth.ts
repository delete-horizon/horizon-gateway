/**
 * @deprecated Prefer local Supabase + VITE_DEV_LOCAL_* (see localAuth.ts / supabase/README.md).
 * Atom-only mock does not satisfy RLS; refresh-token path still works for emergencies.
 */
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/shared/api/supabase";

type DevMockEntitlement = "pro" | "unlimited" | null;

interface DevMockProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_sponsor: boolean;
  sponsor_tier: string | null;
  created_at: string;
  github_id?: string | null;
  github_login?: string | null;
  team_entitlement?: DevMockEntitlement;
}

export function isDevMockAuthEnabled(): boolean {
  return import.meta.env.DEV === true && import.meta.env.VITE_DEV_MOCK_AUTH === "1";
}

function envString(key: keyof ImportMetaEnv, fallback = ""): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function getDevMockUserId(): string {
  return envString("VITE_DEV_MOCK_USER_ID", "00000000-0000-4000-8000-000000000001");
}

function mockTeamEntitlement(): DevMockEntitlement {
  const raw = envString("VITE_DEV_MOCK_TEAM_ENTITLEMENT", "unlimited");
  if (raw === "pro" || raw === "unlimited") {
    return raw;
  }
  return "unlimited";
}

/** Synthetic session when no refresh token is available (UI unlock only). */
export function createDevMockSession(): Session {
  const id = getDevMockUserId();
  const email = envString("VITE_DEV_MOCK_EMAIL", "dev@localhost");
  const displayName = envString("VITE_DEV_MOCK_DISPLAY_NAME", "Local Dev");
  const avatarUrl = envString("VITE_DEV_MOCK_AVATAR_URL", "");
  const githubLogin = envString("VITE_DEV_MOCK_GITHUB_LOGIN", "local-dev");
  const githubId = envString("VITE_DEV_MOCK_GITHUB_ID", "0");
  const nowSec = Math.floor(Date.now() / 1000);

  const user = {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "github", providers: ["github"] },
    user_metadata: {
      full_name: displayName,
      name: displayName,
      user_name: githubLogin,
      preferred_username: githubLogin,
      avatar_url: avatarUrl || undefined,
      provider_id: githubId,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    identities: [
      {
        id: githubId,
        user_id: id,
        identity_id: githubId,
        provider: "github",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_sign_in_at: new Date().toISOString(),
        identity_data: {
          sub: githubId,
          user_name: githubLogin,
          preferred_username: githubLogin,
        },
      },
    ],
  } as User;

  return {
    access_token: "dev-mock-access-token",
    refresh_token: "dev-mock-refresh-token",
    expires_in: 60 * 60 * 24 * 365,
    expires_at: nowSec + 60 * 60 * 24 * 365,
    token_type: "bearer",
    user,
  };
}

export function createDevMockProfile(session: Session): DevMockProfile {
  const meta = session.user.user_metadata ?? {};
  return {
    id: session.user.id,
    email: session.user.email || envString("VITE_DEV_MOCK_EMAIL", "dev@localhost"),
    display_name: (meta.full_name as string | undefined) || (meta.name as string | undefined) || "Local Dev",
    avatar_url: (meta.avatar_url as string | undefined) || null,
    is_sponsor: envString("VITE_DEV_MOCK_IS_SPONSOR", "false") === "true",
    sponsor_tier: null,
    created_at: new Date().toISOString(),
    github_id: (meta.provider_id as string | undefined) || envString("VITE_DEV_MOCK_GITHUB_ID", "0") || null,
    github_login:
      (meta.user_name as string | undefined) || envString("VITE_DEV_MOCK_GITHUB_LOGIN", "local-dev") || null,
    team_entitlement: mockTeamEntitlement(),
  };
}

export type DevMockAuthResult =
  | { mode: "session"; session: Session; profile: DevMockProfile | null }
  | { mode: "atoms-only"; session: Session; profile: DevMockProfile };

/**
 * Prefer a real refreshed session (RLS works). Fall back to atom-only mock
 * keyed by `VITE_DEV_MOCK_USER_ID` (Team UI unlock; Supabase writes will fail RLS).
 */
export async function bootstrapDevMockAuth(): Promise<DevMockAuthResult> {
  const refreshToken = envString("VITE_DEV_MOCK_REFRESH_TOKEN");
  const expectedUserId = getDevMockUserId();

  if (refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      console.error("[dev] mock refreshSession failed:", error?.message ?? "no session");
    } else {
      if (data.session.user.id !== expectedUserId) {
        console.warn(
          `[dev] refreshed user ${data.session.user.id} != VITE_DEV_MOCK_USER_ID ${expectedUserId}; using refreshed user`,
        );
      }
      // Profile row is loaded by the normal onAuthStateChange path when we
      // return session mode — caller should subscribe. Here we only return session.
      return { mode: "session", session: data.session, profile: null };
    }
  }

  const session = createDevMockSession();
  return { mode: "atoms-only", session, profile: createDevMockProfile(session) };
}
