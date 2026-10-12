import { createContext, type ReactNode, useContext } from "react";

export type AppLang = "en" | "ko";

const AppLangContext = createContext<AppLang>("en");

export function AppLangProvider({ lang, children }: { lang: AppLang; children: ReactNode }) {
  return <AppLangContext.Provider value={lang}>{children}</AppLangContext.Provider>;
}

export function useAppLang(): AppLang {
  return useContext(AppLangContext);
}
