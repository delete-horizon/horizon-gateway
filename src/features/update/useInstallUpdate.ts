import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { commands } from "@/shared/api";
import { toastError, toastInfo } from "@/shared/ui/toast";
import { pendingUpdateAtom } from "./store";

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}

async function recoverServeAfterFailedUpdate(): Promise<void> {
  try {
    await commands.ensureServeRunning();
  } catch (err) {
    console.warn("Failed to restart serve after update failure:", err);
  }
}

export function useInstallUpdate() {
  const setPendingUpdate = useSetAtom(pendingUpdateAtom);
  const [isInstalling, setIsInstalling] = useState(false);

  const installUpdate = useCallback(
    async (update: Update, labels?: { installing?: string; failed?: string }) => {
      setIsInstalling(true);
      try {
        toastInfo(labels?.installing ?? "Installing update…");

        if (isWindows()) {
          // Download first; kill serve only inside installWindowsUpdate before UAC.
          await commands.installWindowsUpdate();
          setPendingUpdate(null);
          return;
        }

        try {
          await commands.prepareForUpdate();
        } catch (prepErr) {
          console.warn("Failed to cleanly prepare serve for update:", prepErr);
        }

        await update.downloadAndInstall();
        setPendingUpdate(null);
        await relaunch();
      } catch (err) {
        await recoverServeAfterFailedUpdate();
        const message = err instanceof Error ? err.message : String(err);
        toastError(labels?.failed ? `${labels.failed}: ${message}` : message);
        setIsInstalling(false);
      }
    },
    [setPendingUpdate],
  );

  return { isInstalling, installUpdate };
}
