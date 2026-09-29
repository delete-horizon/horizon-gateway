import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import { activeWorkspaceIdAtom } from "@/entities/team";
import { TeamRecipientComposer } from "./TeamRecipientComposer";

export const RESIDENT_COMPOSER_EVENT = "resident-composer-target";

type ResidentTarget = { profileId: string; name: string };

export function ResidentComposer({ initial }: { initial: ResidentTarget }) {
  const lang = useAtomValue(languageAtom);
  const ko = lang === "ko";
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const [target, setTarget] = useState(initial);

  useEffect(() => {
    setTarget(initial);
  }, [initial]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ profileId: string; label: string }>(RESIDENT_COMPOSER_EVENT, (event) => {
      setTarget({ profileId: event.payload.profileId, name: event.payload.label });
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="bg-base-100 text-base-content">
      {myId && workspaceId ? (
        <TeamRecipientComposer
          workspaceId={workspaceId}
          myId={myId}
          ko={ko}
          focusId={target.profileId}
          fill
          onClose={() => void getCurrentWindow().close()}
        />
      ) : (
        <p className="px-2 text-[11px] leading-8 text-base-content/50">
          {ko ? "로그인이 필요합니다." : "Sign in first."}
        </p>
      )}
    </div>
  );
}
