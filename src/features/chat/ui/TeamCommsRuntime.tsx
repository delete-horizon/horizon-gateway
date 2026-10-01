import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { supabaseProfileAtom, supabaseSessionAtom } from "@/entities/app";
import {
  announcePresence,
  announceWorn,
  type ChatPeerEndpoint,
  DEFAULT_AVATAR_KIT,
  ensureChatNotificationPermission,
  fetchWorn,
  flushOutbox,
  handleIncomingFrame,
  kitsForWorn,
  overlayCharactersEnabledAtom,
  publishWorn,
  readLocalWorn,
  refreshPeers,
  refsToKit,
  setWornHandshakeHandler,
  showCommBubble,
  syncCommResidents,
  WORN_STORAGE_KEY,
} from "@/entities/chat";
import { activeWorkspaceIdAtom, listMembers } from "@/entities/team";
import { commands, unwrap } from "@/shared/api";
import { localDummies } from "../lib/localDummies";

function peerOnline(peers: ChatPeerEndpoint[], profileId: string): boolean {
  const peer = peers.find((item) => item.profileId === profileId);
  if (!peer || peer.lanPort <= 0) {
    return false;
  }
  const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(peer.updatedAt)) / 1000));
  return ageSec < 120;
}

/**
 * Runs only in the main window: announces LAN endpoints, listens for P2P frames,
 * plays comm actions, flushes outbox. The workspace shell also keeps monitor residents.
 */
export function TeamCommsRuntime() {
  const session = useAtomValue(supabaseSessionAtom);
  const profile = useAtomValue(supabaseProfileAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const overlayOn = useAtomValue(overlayCharactersEnabledAtom);
  const myId = session?.user?.id ?? null;
  const started = useRef(false);
  const overlayOnRef = useRef(overlayOn);
  overlayOnRef.current = overlayOn;
  const ownsOverlayRef = useRef(false);
  const [ownsOverlay, setOwnsOverlay] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const role = unwrap(await commands.appShellRole());
        if (cancelled) {
          return;
        }
        const owns = role === "workspace";
        ownsOverlayRef.current = owns;
        setOwnsOverlay(owns);
      } catch {
        /* outside Tauri */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!myId || !workspaceId) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let unlistenBubble: (() => void) | undefined;
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
          void handleIncomingFrame(event.payload, myId, {
            overlayBubble: ownsOverlayRef.current && overlayOnRef.current,
          });
        });
      } catch (e) {
        console.warn("chat frame listen failed", e);
      }

      try {
        unlistenBubble = await listen<{ profileId: string; text: string }>("comm-bubble", (event) => {
          if (!ownsOverlayRef.current || !overlayOnRef.current) {
            return;
          }
          const { profileId, text } = event.payload ?? {};
          if (!profileId || !text) {
            return;
          }
          void showCommBubble(profileId, text).catch(() => {});
        });
      } catch (e) {
        console.warn("comm bubble listen failed", e);
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
      unlistenBubble?.();
    };
  }, [myId, workspaceId]);

  useEffect(() => {
    if (!ownsOverlay) {
      return;
    }
    let cancelled = false;

    const sync = async () => {
      if (!overlayOn || !myId || !workspaceId) {
        await syncCommResidents([]).catch(() => {});
        await invoke("clear_incoming_cards").catch(() => {});
        return;
      }
      await invoke("prepare_incoming_cards").catch(() => {});
      const [members, peers] = await Promise.all([
        listMembers(workspaceId).catch(() => []),
        refreshPeers(workspaceId).catch(() => []),
      ]);
      if (cancelled) {
        return;
      }
      const local = readLocalWorn();
      const looks = await fetchWorn([myId, ...members.map((member) => member.profile_id)]).catch(() => []);
      const mine = { profileId: myId, updatedAt: "", refs: local };
      const kits = await kitsForWorn([mine, ...looks.filter((look) => look.profileId !== myId)]).catch(() => new Map());
      const kitOf = (profileId: string) =>
        kits.get(profileId) ?? (profileId === myId ? refsToKit(local) : DEFAULT_AVATAR_KIT);
      const myLabel = profile?.display_name?.trim() || "나";
      await syncCommResidents([
        { profileId: myId, label: myLabel, online: true, kit: kitOf(myId) },
        ...members
          .filter((member) => member.profile_id !== myId)
          .map((member) => ({
            profileId: member.profile_id,
            label: member.profile?.display_name?.trim() || member.profile_id.slice(0, 6),
            online: peerOnline(peers, member.profile_id),
            kit: kitOf(member.profile_id),
          })),
        ...localDummies().map((dummy) => ({
          profileId: dummy.id,
          label: dummy.label,
          online: true,
          kit: dummy.kit,
        })),
      ]).catch((e: unknown) => console.warn("sync residents", e));
    };

    const stopHandshake = setWornHandshakeHandler((ping) => {
      void (async () => {
        await sync();
        if (cancelled || ping.phase !== "announce" || !myId || !workspaceId) {
          return;
        }
        const peers = await refreshPeers(workspaceId).catch(() => []);
        const peer = peers.find((item) => item.profileId === ping.profileId);
        if (peer) {
          await announceWorn(myId, [peer], "reply");
        }
      })();
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key === WORN_STORAGE_KEY) {
        void sync();
      }
    };
    window.addEventListener("storage", onStorage);

    void (async () => {
      if (!myId || !workspaceId) {
        return;
      }
      await publishWorn(readLocalWorn()).catch(() => {});
      const peers = await refreshPeers(workspaceId).catch(() => []);
      await announceWorn(myId, peers, "announce");
      await sync();
    })();
    const syncTimer = window.setInterval(() => void sync(), 8000);
    const poll = window.setInterval(() => {
      if (!overlayOnRef.current) {
        return;
      }
      void (async () => {
        try {
          const hit = unwrap(await commands.takeOverlayResidentClick());
          if (!hit || cancelled) {
            return;
          }
          unwrap(await commands.openResidentComposer(hit.profileId, hit.label, hit.x, hit.y));
        } catch (e) {
          console.warn("resident composer", e);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      stopHandshake();
      window.removeEventListener("storage", onStorage);
      window.clearInterval(syncTimer);
      window.clearInterval(poll);
    };
  }, [ownsOverlay, overlayOn, myId, workspaceId, profile?.display_name]);

  return null;
}
