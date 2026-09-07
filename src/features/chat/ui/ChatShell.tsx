import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { PopupTitlebar } from "@/features/popup-window";

interface ChatShellProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function ChatShell({ title, children, footer }: ChatShellProps) {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-base-200 font-sans text-base-content">
      <PopupTitlebar title={title} icon={<MessageCircle className="w-4 h-4" />} accent="emerald" />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
      {footer ? <div className="shrink-0 border-t border-base-300 bg-base-100">{footer}</div> : null}
    </div>
  );
}
