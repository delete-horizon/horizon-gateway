import { createFileRoute } from "@tanstack/react-router";
import { AvatarStudio } from "@/features/chat";

type AvatarStudioSearch = { slot?: string; id?: string; owned?: string };

export const Route = createFileRoute("/chat/avatar-studio")({
  validateSearch: (search: Record<string, unknown>): AvatarStudioSearch => ({
    slot: typeof search.slot === "string" ? search.slot : undefined,
    id: typeof search.id === "string" ? search.id : undefined,
    owned: typeof search.owned === "string" ? search.owned : undefined,
  }),
  component: AvatarStudioPage,
});

function AvatarStudioPage() {
  const { slot, id, owned } = Route.useSearch();
  return <AvatarStudio initialSlot={slot} initialId={id} initialOwnedId={owned} />;
}
