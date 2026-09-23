/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_PAID_CHECKOUT?: string;
  readonly VITE_LEMON_SQUEEZY_CHECKOUT_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;

  /** Local Supabase auto-login (DEV + localhost URL). */
  readonly VITE_DEV_LOCAL_EMAIL?: string;
  readonly VITE_DEV_LOCAL_PASSWORD?: string;
  readonly VITE_DEV_LOCAL_DISPLAY_NAME?: string;
  readonly VITE_DEV_LOCAL_GITHUB_LOGIN?: string;
  readonly VITE_DEV_LOCAL_TEAM_ENTITLEMENT?: string;

  /**
   * @deprecated Prefer local Supabase + VITE_DEV_LOCAL_*.
   * Set to `1` with Vite DEV for atom-only mock (RLS will fail without refresh token).
   */
  readonly VITE_DEV_MOCK_AUTH?: string;
  readonly VITE_DEV_MOCK_USER_ID?: string;
  readonly VITE_DEV_MOCK_REFRESH_TOKEN?: string;
  readonly VITE_DEV_MOCK_EMAIL?: string;
  readonly VITE_DEV_MOCK_DISPLAY_NAME?: string;
  readonly VITE_DEV_MOCK_AVATAR_URL?: string;
  readonly VITE_DEV_MOCK_GITHUB_LOGIN?: string;
  readonly VITE_DEV_MOCK_GITHUB_ID?: string;
  readonly VITE_DEV_MOCK_IS_SPONSOR?: string;
  readonly VITE_DEV_MOCK_TEAM_ENTITLEMENT?: string;
}
