import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { listen } from "@/shared/lib/tauri/client";
import { getHubWindowOrigin, HUB_HANDOFF, type HubHandoffEventPayload } from "@/shared/lib/tauri/hubEvents";
import type { HandoffTarget } from "../lib/hubHandoff";
import { hubHandoffAtom, hubHandoffConsumedIdAtom, hubHandoffRemoteTargetAtom } from "../store";

/** Syncs handoff payloads across Tauri windows via hubEvents. */
export function useHubHandoffSync(): void {
  const setHandoff = useSetAtom(hubHandoffAtom);
  const setConsumedId = useSetAtom(hubHandoffConsumedIdAtom);
  const setRemoteTarget = useSetAtom(hubHandoffRemoteTargetAtom);

  useEffect(() => {
    const unlisten = listen<HubHandoffEventPayload>(HUB_HANDOFF, (event) => {
      const payload = event.payload;
      if (!payload || payload.origin === getHubWindowOrigin()) {
        return;
      }

      setHandoff(payload.handoff as Parameters<typeof setHandoff>[0]);
      setConsumedId(null);

      if (payload.target) {
        setRemoteTarget(payload.target as HandoffTarget);
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setHandoff, setConsumedId, setRemoteTarget]);
}
