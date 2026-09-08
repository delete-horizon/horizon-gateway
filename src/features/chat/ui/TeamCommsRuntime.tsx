import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { supabaseSessionAtom } from "@/entities/app";
import {
  announcePresence,
  ensureChatNotificationPermission,
  flushOutbox,
  handleIncomingFrame,
} from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team/store";

/**
 * Runs only in the main window: announces LAN endpoints, listens for P2P frames,
 * plays comm actions, flushes outbox.
 */
export function TeamCommsRuntime() {
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const started = useRef(false);

  useEffect(() => {
    if (!myId || !workspaceId) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    let cancelled = false;

    void (async () => {
      try {
        await ensureChatNotificationPermission();
      } catch {
        /* optional */
      }

      try {
        await announcePresence({ workspaceId, profileId: myId, isHost: true });
        started.current = true;
      } catch (e) {
        console.warn("chat announce failed", e);
      }

      try {
        unlisten = await listen<string>("chat-frame-received", (event) => {
          void handleIncomingFrame(event.payload, myId);
        });
      } catch (e) {
        console.warn("chat frame listen failed", e);
      }

      const tick = () => {
        if (cancelled) {
          return;
        }
        void announcePresence({ workspaceId, profileId: myId, isHost: true }).catch(() => {});
        void flushOutbox(workspaceId).catch(() => {});
        timer = window.setTimeout(tick, 15000);
      };
      tick();
    })();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      unlisten?.();
    };
  }, [myId, workspaceId]);

  return null;
}
