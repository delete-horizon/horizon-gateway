import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { languageAtom, supabaseProfileAtom, supabaseSessionAtom, userProfileAtom } from "@/entities/app";
import {
  type CommActionKind,
  ensureDmRoom,
  type ResolvedHeldAction,
  readLocalWorn,
  refsToKit,
  reloadCommAvatarCatalog,
  resolveHeldAction,
  sendAction,
  WORN_STORAGE_KEY,
} from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team";
import { commands, unwrap } from "@/shared/api";

export const RESIDENT_ACTION_EVENT = "resident-action-target";

const COFFEE: { kind: CommActionKind; ko: string; en: string }[] = [
  { kind: "coffee_ask", ko: "커피 사주세요", en: "Buy me coffee" },
  { kind: "coffee_give", ko: "커피 사줄게요", en: "Coffee on me" },
];

const FLY_COUNTS = [1, 5, 10, 20] as const;

type ResidentTarget = { profileId: string; name: string };

export function ResidentActionMenu({ initial }: { initial: ResidentTarget }) {
  const lang = useAtomValue(languageAtom);
  const ko = lang === "ko";
  const session = useAtomValue(supabaseSessionAtom);
  const dbProfile = useAtomValue(supabaseProfileAtom);
  const localProfile = useAtomValue(userProfileAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const [target, setTarget] = useState(initial);
  const [heldAction, setHeldAction] = useState<ResolvedHeldAction>(() => resolveHeldAction(null, "none"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const senderLabel =
    dbProfile?.display_name?.trim() || localProfile.name?.trim() || dbProfile?.email?.split("@")[0] || "나";

  const closeMenu = useCallback(() => {
    void getCurrentWindow()
      .close()
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTarget(initial);
  }, [initial]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ profileId: string; label: string }>(RESIDENT_ACTION_EVENT, (event) => {
      const profileId = event.payload.profileId?.trim() ?? "";
      if (!profileId) {
        return;
      }
      setTarget({ profileId, name: event.payload.label?.trim() || profileId });
      setError(null);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (myId && target.profileId === myId) {
      closeMenu();
    }
  }, [myId, target.profileId, closeMenu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMenu]);

  useEffect(() => {
    let cancelled = false;
    const apply = (heldId: string) => {
      void reloadCommAvatarCatalog()
        .then((catalog) => {
          if (!cancelled) {
            setHeldAction(resolveHeldAction(catalog, heldId));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHeldAction(resolveHeldAction(null, heldId));
          }
        });
    };
    apply(refsToKit(readLocalWorn()).held);
    const onStorage = (event: StorageEvent) => {
      if (event.key === WORN_STORAGE_KEY) {
        apply(refsToKit(readLocalWorn()).held);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const run = useCallback(
    async (kind: CommActionKind, count = 1) => {
      if (!myId || !workspaceId || busy) {
        return;
      }
      if (target.profileId === myId) {
        closeMenu();
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const room = await ensureDmRoom({
          workspaceId,
          myId,
          peerId: target.profileId,
          peerName: target.name,
        });
        await sendAction({
          roomId: room.id,
          myId,
          workspaceId,
          actionKind: kind,
          count,
          senderLabel,
        });
        closeMenu();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, closeMenu, myId, senderLabel, target.name, target.profileId, workspaceId],
  );

  const openChat = useCallback(async () => {
    if (busy) {
      return;
    }
    setError(null);
    try {
      unwrap(await commands.openResidentComposer(target.profileId, target.name, 0, 0));
      closeMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [busy, closeMenu, target.name, target.profileId]);

  if (!myId || !workspaceId) {
    return (
      <p className="px-2 text-[11px] leading-8 text-base-content/50">
        {ko ? "로그인이 필요합니다." : "Sign in first."}
      </p>
    );
  }

  const heldLabel = ko ? heldAction.ko : heldAction.en;

  return (
    <div className="fixed inset-0 flex flex-col bg-base-100 text-base-content">
      <div className="flex h-6 shrink-0 items-center gap-2 px-2">
        <p className="min-w-0 flex-1 truncate text-[10px] font-medium text-base-content/50">{target.name}</p>
        <button
          type="button"
          className="shrink-0 text-[10px] text-base-content/40 hover:text-base-content"
          onClick={closeMenu}
        >
          {ko ? "닫기" : "Close"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1">
        <MenuRow disabled={busy} onClick={() => void run(heldAction.overlay)}>
          {heldLabel}
        </MenuRow>
        {COFFEE.map((action) => (
          <MenuRow key={action.kind} disabled={busy} onClick={() => void run(action.kind)}>
            {ko ? action.ko : action.en}
          </MenuRow>
        ))}
        <div className="flex h-7 items-center gap-1 px-1">
          <span className="text-[10px] text-base-content/50">{ko ? "똥파리" : "Flies"}</span>
          {FLY_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              disabled={busy}
              className="h-6 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] hover:bg-amber-500/20 disabled:opacity-40"
              onClick={() => void run("fly", count)}
            >
              ×{count}
            </button>
          ))}
        </div>
        <MenuRow disabled={busy} onClick={() => void openChat()}>
          {ko ? "대화 열기" : "Open chat"}
        </MenuRow>
        {error ? <p className="px-1 text-[10px] leading-snug text-error">{error}</p> : null}
      </div>
    </div>
  );
}

function MenuRow({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-full rounded-md px-2 text-left text-xs hover:bg-base-200/60 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
