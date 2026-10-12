import { type InvokeArgs, type InvokeOptions, invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  type EventCallback,
  type EventName,
  type Options as ListenOptions,
  listen as tauriListen,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/**
 * Desktop command and event transport.
 *
 * The default speaks Tauri IPC and forwards `invoke` / `listen` unchanged.
 * A future direct serve client replaces it with {@link setCoreClient}.
 * This module does not open a socket.
 */
export interface CoreClient {
  invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T>;
  listen<T>(event: EventName, handler: EventCallback<T>, options?: ListenOptions): Promise<UnlistenFn>;
}

function callTauriInvoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (options !== undefined) {
    return tauriInvoke<T>(cmd, args, options);
  }
  if (args !== undefined) {
    return tauriInvoke<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd);
}

function callTauriListen<T>(event: EventName, handler: EventCallback<T>, options?: ListenOptions): Promise<UnlistenFn> {
  if (options !== undefined) {
    return tauriListen<T>(event, handler, options);
  }
  return tauriListen<T>(event, handler);
}

const tauriCoreClient: CoreClient = {
  invoke: callTauriInvoke,
  listen: callTauriListen,
};

let active: CoreClient = tauriCoreClient;

/** Swap the desktop transport. The running app keeps the Tauri client. */
export function setCoreClient(next: CoreClient): void {
  active = next;
}

/** Restore Tauri IPC after {@link setCoreClient}. */
export function resetCoreClient(): void {
  active = tauriCoreClient;
}

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  return active.invoke<T>(cmd, args, options);
}

export function listen<T>(event: EventName, handler: EventCallback<T>, options?: ListenOptions): Promise<UnlistenFn> {
  return active.listen<T>(event, handler, options);
}
