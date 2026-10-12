import { useEffect } from "react";
import { listen } from "@/shared/lib/tauri/client";
import { HUB_DATA_CHANGED, type HubDataChangedReason } from "@/shared/lib/tauri/hubEvents";

let subscriberCount = 0;
let unlistenFns: Array<() => void> = [];

export function useHubDataSubscription(onDataChanged: (reason?: HubDataChangedReason) => Promise<void>) {
  useEffect(() => {
    subscriberCount++;
    if (subscriberCount === 1) {
      void onDataChanged();
      void listen(HUB_DATA_CHANGED, (event) => {
        const reason = (event.payload as { reason?: HubDataChangedReason } | undefined)?.reason;
        void onDataChanged(reason);
      }).then((fn) => {
        unlistenFns.push(fn);
      });
      void listen("local-routes-updated", () => {
        void onDataChanged("routes");
      }).then((fn) => {
        unlistenFns.push(fn);
      });
      void listen("proxy-settings-changed", () => {
        void onDataChanged();
      }).then((fn) => {
        unlistenFns.push(fn);
      });
      void listen("serve-ready", () => {
        void onDataChanged();
      }).then((fn) => {
        unlistenFns.push(fn);
      });
    }

    return () => {
      subscriberCount--;
      if (subscriberCount === 0) {
        for (const unlisten of unlistenFns) {
          unlisten();
        }
        unlistenFns = [];
      }
    };
  }, [onDataChanged]);
}
