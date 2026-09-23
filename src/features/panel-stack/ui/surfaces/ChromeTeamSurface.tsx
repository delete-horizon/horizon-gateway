import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { languageAtom, openWorkspaceCompanion } from "@/entities/app";

/** Hub no longer hosts the team shell. This surface only forwards to the companion. */
export function ChromeTeamSurface() {
  const lang = useAtomValue(languageAtom);

  useEffect(() => {
    void openWorkspaceCompanion();
  }, []);

  return (
    <p className="p-6 text-sm text-base-content/70">
      {lang === "ko" ? "팀 워크스페이스 앱에서 엽니다." : "Opening the workspace app."}
    </p>
  );
}
