import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/api/database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const safeUrl = isValidUrl(supabaseUrl) ? supabaseUrl : "https://placeholder-project.supabase.co";
const safeKey = supabaseAnonKey || "placeholder-key";

export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    // Desktop handles the custom-scheme callback itself (see bootstrap deep-link).
    detectSessionInUrl: false,
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
  },
});
