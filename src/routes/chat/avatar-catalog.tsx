import { createFileRoute } from "@tanstack/react-router";
import { AvatarCatalogPage } from "@/features/chat";

export const Route = createFileRoute("/chat/avatar-catalog")({
  component: AvatarCatalogPage,
});
