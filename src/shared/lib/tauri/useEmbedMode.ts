import { useWindowLabel } from "./useWindowLabel";

export type EmbedMode = "standalone" | "popup" | "detached" | "chat";

export function useIsPopupWindow(): boolean {
  const label = useWindowLabel();
  return label.startsWith("popup-");
}

export function useIsChatWindow(): boolean {
  const label = useWindowLabel();
  return label === "chat-inbox" || label.startsWith("chat-room-");
}

export function useEmbedMode(): EmbedMode {
  const label = useWindowLabel();
  if (label.startsWith("popup-")) {
    return "popup";
  }
  if (label.startsWith("detached-")) {
    return "detached";
  }
  if (label === "chat-inbox" || label.startsWith("chat-room-")) {
    return "chat";
  }
  return "standalone";
}

export function useIsDetachedWindow(): boolean {
  const label = useWindowLabel();
  return label.startsWith("detached-");
}

export function useIsSecondaryWindow(): boolean {
  const label = useWindowLabel();
  return label !== "main";
}

export function useIsEmbeddedPage(): boolean {
  return useEmbedMode() !== "standalone";
}
