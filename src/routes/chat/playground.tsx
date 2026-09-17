import { createFileRoute } from "@tanstack/react-router";
import { OverlayPlayground } from "@/features/chat";

export const Route = createFileRoute("/chat/playground")({
  component: OverlayPlayground,
});
