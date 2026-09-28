import { createFileRoute } from "@tanstack/react-router";
import { ResidentComposer } from "@/features/chat";

type ResidentSearch = { profileId: string; name: string };

export const Route = createFileRoute("/chat/resident")({
  validateSearch: (search: Record<string, unknown>): ResidentSearch => ({
    profileId: typeof search.profileId === "string" ? search.profileId : "",
    name: typeof search.name === "string" ? search.name : "",
  }),
  component: ResidentRoute,
});

function ResidentRoute() {
  const search = Route.useSearch();
  return <ResidentComposer initial={{ profileId: search.profileId, name: search.name }} />;
}
