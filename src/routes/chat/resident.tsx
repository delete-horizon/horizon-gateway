import { createFileRoute } from "@tanstack/react-router";
import { ResidentActionMenu, ResidentComposer } from "@/features/chat";

type ResidentSearch = { profileId: string; name: string; menu: boolean };

function menuFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export const Route = createFileRoute("/chat/resident")({
  validateSearch: (search: Record<string, unknown>): ResidentSearch => ({
    profileId: typeof search.profileId === "string" ? search.profileId : "",
    name: typeof search.name === "string" ? search.name : "",
    menu: menuFlag(search.menu),
  }),
  component: ResidentRoute,
});

function ResidentRoute() {
  const search = Route.useSearch();
  if (search.menu) {
    return <ResidentActionMenu initial={{ profileId: search.profileId, name: search.name }} />;
  }
  return <ResidentComposer initial={{ profileId: search.profileId, name: search.name }} />;
}
