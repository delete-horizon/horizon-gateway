import { useEffect } from "react";
import { installChatUiBridge } from "@/entities/chat";

/** Mount in every webview so chat popups receive cross-window UI updates. */
export function ChatLiveBridge() {
  useEffect(() => installChatUiBridge(), []);
  return null;
}
