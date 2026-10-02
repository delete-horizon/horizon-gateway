import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useMainWindowBehavior } from "../window-behavior/useMainWindowBehavior";

const appWindow = getCurrentWindow();

interface WindowControlsProps {
  /** Main hub applies hide/quit preferences. Detached windows just close themselves. */
  scope?: "main" | "window";
}

export function WindowControls({ scope = "window" }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const main = useMainWindowBehavior(scope === "main");

  const updateState = useCallback(async () => {
    setIsMaximized(await appWindow.isMaximized());
  }, []);

  useEffect(() => {
    void updateState();
    const unlisten = appWindow.onResized(() => updateState());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [updateState]);

  const onMinimize = () => {
    if (scope === "main") {
      void main.handleMinimize();
      return;
    }
    void appWindow.minimize();
  };

  const onClose = () => {
    if (scope === "main") {
      void main.handleClose();
      return;
    }
    void appWindow.close();
  };

  return (
    <>
      {scope === "main" ? main.dialog : null}
      <div className="flex items-center h-full shrink-0">
        <button
          type="button"
          data-tauri-drag-region={false}
          onClick={onMinimize}
          className="w-11 h-full flex items-center justify-center hover:bg-base-300 text-base-content/55 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          data-tauri-drag-region={false}
          onClick={() => appWindow.toggleMaximize()}
          className="w-11 h-full flex items-center justify-center hover:bg-base-300 text-base-content/55 transition-colors"
        >
          {isMaximized ? <Square className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
        <button
          type="button"
          data-tauri-drag-region={false}
          onClick={onClose}
          className={clsx(
            "w-11 h-full flex items-center justify-center hover:bg-error hover:text-error-content text-base-content/55 transition-colors",
          )}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}
