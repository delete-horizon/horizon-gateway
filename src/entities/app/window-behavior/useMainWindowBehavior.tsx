import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { commands } from "@/shared/api";
import { listen } from "@/shared/lib/tauri/client";
import { languageAtom } from "../i18n/store";
import { type CloseBehavior, closeBehaviorAtom, type MinimizeBehavior, minimizeBehaviorAtom } from "./store";
import { WindowActionDialog } from "./WindowActionDialog";

const appWindow = getCurrentWindow();

export function useMainWindowBehavior(enabled: boolean) {
  const lang = useAtomValue(languageAtom);
  const [closeBehavior, setCloseBehavior] = useAtom(closeBehaviorAtom);
  const [minimizeBehavior, setMinimizeBehavior] = useAtom(minimizeBehaviorAtom);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [minimizeDialogOpen, setMinimizeDialogOpen] = useState(false);

  const hideToTray = useCallback(async () => {
    await appWindow.hide();
  }, []);

  const quitApp = useCallback(async () => {
    await commands.quitApp();
  }, []);

  const minimizeToTaskbar = useCallback(async () => {
    await appWindow.minimize();
  }, []);

  const applyClose = useCallback(
    async (choice: Exclude<CloseBehavior, "ask">) => {
      if (choice === "quit") {
        await quitApp();
        return;
      }
      await hideToTray();
    },
    [hideToTray, quitApp],
  );

  const applyMinimize = useCallback(
    async (choice: Exclude<MinimizeBehavior, "ask">) => {
      if (choice === "tray") {
        await hideToTray();
        return;
      }
      await minimizeToTaskbar();
    },
    [hideToTray, minimizeToTaskbar],
  );

  const handleClose = useCallback(async () => {
    if (closeBehavior === "ask") {
      setCloseDialogOpen(true);
      return;
    }
    await applyClose(closeBehavior);
  }, [applyClose, closeBehavior]);

  const handleMinimize = useCallback(async () => {
    if (minimizeBehavior === "ask") {
      setMinimizeDialogOpen(true);
      return;
    }
    await applyMinimize(minimizeBehavior);
  }, [applyMinimize, minimizeBehavior]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const unlisten = listen("main-window-close-requested", () => {
      void handleClose();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [enabled, handleClose]);

  const dialog =
    enabled && (closeDialogOpen || minimizeDialogOpen) ? (
      <WindowActionDialog
        kind={closeDialogOpen ? "close" : "minimize"}
        lang={lang}
        onCancel={() => {
          setCloseDialogOpen(false);
          setMinimizeDialogOpen(false);
        }}
        onConfirm={(choice, remember) => {
          if (closeDialogOpen) {
            const closeChoice = choice as Exclude<CloseBehavior, "ask">;
            if (remember) {
              setCloseBehavior(closeChoice);
            }
            setCloseDialogOpen(false);
            void applyClose(closeChoice);
            return;
          }
          const minimizeChoice = choice as Exclude<MinimizeBehavior, "ask">;
          if (remember) {
            setMinimizeBehavior(minimizeChoice);
          }
          setMinimizeDialogOpen(false);
          void applyMinimize(minimizeChoice);
        }}
      />
    ) : null;

  return { handleClose, handleMinimize, dialog };
}
