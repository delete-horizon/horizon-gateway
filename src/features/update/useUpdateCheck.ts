import type { Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { commands } from "@/shared/api";
import { pendingUpdateAtom } from "./store";

export interface UpdateState {
  update: Update | null;
  isChecking: boolean;
  error: string | null;
}

export function useUpdateCheck(options?: { onMount?: boolean; delayMs?: number }) {
  const { onMount = true, delayMs = 3000 } = options ?? {};
  const setPendingUpdate = useSetAtom(pendingUpdateAtom);
  const [state, setState] = useState<UpdateState>({
    update: null,
    isChecking: false,
    error: null,
  });

  const checkForUpdates = useCallback(async () => {
    setState((s) => ({ ...s, isChecking: true, error: null }));
    try {
      const role = await commands.appShellRole();
      if (role.status === "ok" && role.data === "workspace") {
        setPendingUpdate(null);
        setState({ update: null, isChecking: false, error: null });
        return null;
      }
      const update = await check();
      const next = update ?? null;
      setPendingUpdate(next);
      setState({
        update: next,
        isChecking: false,
        error: null,
      });
      return update;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPendingUpdate(null);
      setState({
        update: null,
        isChecking: false,
        error: message,
      });
      return null;
    }
  }, [setPendingUpdate]);

  useEffect(() => {
    if (onMount) {
      const t = setTimeout(checkForUpdates, delayMs);
      return () => clearTimeout(t);
    }
  }, [onMount, delayMs, checkForUpdates]);

  return { ...state, checkForUpdates };
}
