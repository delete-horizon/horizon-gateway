import { createFileRoute } from "@tanstack/react-router";
import { AvatarStudio } from "@/features/chat";

export const Route = createFileRoute("/chat/avatar-studio")({
  component: AvatarStudio,
});
