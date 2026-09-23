import { createFileRoute } from "@tanstack/react-router";
import { AvatarDress } from "@/features/chat";

export const Route = createFileRoute("/chat/avatar")({
  component: AvatarDress,
});
