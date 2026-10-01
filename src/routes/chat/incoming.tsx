import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { languageAtom } from "@/entities/app";
import { IncomingMessageStack } from "@/features/chat";

export const Route = createFileRoute("/chat/incoming")({
  component: IncomingCardsRoute,
});

function IncomingCardsRoute() {
  const lang = useAtomValue(languageAtom);
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);
  return (
    <div className="h-screen w-full overflow-hidden bg-transparent text-base-content">
      <IncomingMessageStack ko={lang === "ko"} />
    </div>
  );
}
