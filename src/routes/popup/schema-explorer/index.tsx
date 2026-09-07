import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { FileCode } from "lucide-react";
import { languageAtom } from "@/entities/app";
import { PopupShell, popupEn, popupKo } from "@/features/popup-window";
import { ApiSchemaPage } from "@/routes/apis/schema/index";
import { useEmbedMode } from "@/shared/lib/tauri/useEmbedMode";

function PopupSchemaExplorerPage() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? popupKo : popupEn;
  const { d } = Route.useSearch();
  const embedMode = useEmbedMode();
  const page = (
    <ApiSchemaPage
      initialDomainId={d}
      embedMode={embedMode === "standalone" || embedMode === "chat" ? "popup" : embedMode}
    />
  );

  if (embedMode === "detached") {
    return page;
  }

  return (
    <PopupShell title={t.schemaExplorerTitle} icon={<FileCode className="w-4 h-4" />} accent="indigo" fullWidth>
      {page}
    </PopupShell>
  );
}

export const Route = createFileRoute("/popup/schema-explorer/")({
  validateSearch: (search: Record<string, unknown>) => ({
    d:
      typeof search.d === "number"
        ? search.d
        : typeof search.d === "string"
          ? Number(search.d) || undefined
          : undefined,
  }),
  component: PopupSchemaExplorerPage,
});
