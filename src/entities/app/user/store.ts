import { atomWithStorage } from "jotai/utils";

export interface UserProfile {
  name: string;
  role: string;
  avatarColor: string;
  isSetupComplete: boolean;
}

export const AVATAR_COLORS = [
  "bg-gradient-to-br from-indigo-500 to-purple-600",
  "bg-gradient-to-br from-blue-500 to-cyan-400",
  "bg-gradient-to-br from-emerald-400 to-teal-600",
  "bg-gradient-to-br from-amber-400 to-orange-500",
  "bg-gradient-to-br from-rose-400 to-red-500",
  "bg-gradient-to-br from-fuchsia-500 to-pink-500",
  "bg-slate-800",
] as const;

export const defaultProfile: UserProfile = {
  name: "",
  role: "",
  avatarColor: AVATAR_COLORS[0],
  isSetupComplete: false,
};

export const userProfileAtom = atomWithStorage<UserProfile>("horizon-gateway-user-profile", defaultProfile);

export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(trimmed);
  if (isKorean) {
    return trimmed.substring(0, 2);
  }

  return trimmed.substring(0, 2).toUpperCase();
}

import type { Session } from "@supabase/supabase-js";
import { atom } from "jotai";

export interface DBProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_sponsor: boolean;
  sponsor_tier: string | null;
  created_at: string;
  /** GitHub numeric user id (as string), used server-side to match Sponsors webhook events. */
  github_id?: string | null;
  /** GitHub login/username at time of last sync. Sponsors matching falls back to this. */
  github_login?: string | null;
  /** Set by the GitHub Sponsors webhook (server-only write) when sponsorship first activates. */
  sponsor_since?: string | null;
  /** Sponsorship cycle timestamp from the sponsors webhook. Server-only write. */
  sponsor_cycle_at?: string | null;
  /**
   * Internal / owner bypass for Team features without Lemon billing.
   * `pro` = treated as Team Pro, `unlimited` = no seat/workspace caps.
   * Null = normal billing rules. Server-only write.
   */
  team_entitlement?: "pro" | "unlimited" | null;
}

export const supabaseSessionAtom = atom<Session | null>(null);
export const supabaseProfileAtom = atom<DBProfile | null>(null);

// Experimental Labs Feature Flags
import { atomWithStorage as jotaiAtomWithStorage } from "jotai/utils";
export const experimentalAiAutocompleteAtom = jotaiAtomWithStorage<boolean>(
  "horizon-experimental-ai-autocomplete",
  false,
);
export const experimentalCustomThemeAtom = jotaiAtomWithStorage<boolean>("horizon-experimental-custom-theme", false);
