import { createContext, type ReactNode, useContext } from "react";

export type AppLang = "en" | "ko";

const AppLangContext = createContext<AppLang>("en");

export function AppLangProvider({ lang, children }: { lang: AppLang; children: ReactNode }) {
  return <AppLangContext.Provider value={lang}>{children}</AppLangContext.Provider>;
}

export function useAppLang(): AppLang {
  return useContext(AppLangContext);
}

/** Language persisted by the desktop app, for code that cannot call a hook. */
export function readAppLang(): AppLang {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem("horizon-gateway-language");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === "ko" || parsed === "en") {
          return parsed;
        }
      }
    } catch {
      // Ignore a bad stored value and fall through to the browser language.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return "en";
}
