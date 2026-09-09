import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { useSetAtom } from "jotai";
import { Download, Loader2Icon, X } from "lucide-react";
import { useCallback, useState } from "react";
import { commands } from "@/shared/api";
import { Button } from "@/shared/ui/button/Button";
import { pendingUpdateAtom } from "./store";

export interface UpdateBannerProps {
  update: Update;
  onDismiss?: () => void;
}

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

export function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  const setPendingUpdate = useSetAtom(pendingUpdateAtom);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    setIsInstalling(true);
    setInstallError(null);
    try {
      if (isWindows()) {
        await commands.installWindowsUpdate();
        setPendingUpdate(null);
        return;
      }
      try {
        await commands.prepareForUpdate();
      } catch (prepErr) {
        console.warn("Failed to cleanly prepare serve for update:", prepErr);
      }
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") {
          setIsInstalling(false);
        }
      });
      setPendingUpdate(null);
      await relaunch();
    } catch (err) {
      await recoverServeAfterFailedUpdate();
      const message = err instanceof Error ? err.message : String(err);
      setInstallError(message);
      setIsInstalling(false);
    }
  }, [setPendingUpdate, update]);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 bg-blue-600 text-white rounded-lg shadow-lg">
      <div className="flex items-center gap-2 min-w-0">
        <Download className="w-5 h-5 flex-shrink-0 text-blue-200" />
        <div className="min-w-0">
          <p className="font-medium truncate">Update available: v{update.version}</p>
          {update.body && <p className="text-sm text-blue-100 truncate">{update.body}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {installError && <span className="text-sm text-red-200">{installError}</span>}
        {onDismiss && (
          <Button
            variant="secondary"
            size="icon"
            className="!bg-blue-500/50 hover:!bg-blue-500/70 !text-white !border-0"
            onClick={onDismiss}
            disabled={isInstalling}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          className="gap-2 !bg-white !text-blue-600 hover:!bg-blue-50 flex"
          onClick={handleInstall}
          disabled={isInstalling}
        >
          {isInstalling ? (
            <>
              <Loader2Icon className="w-4 h-4 animate-spin" />
              Installing...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Update
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
