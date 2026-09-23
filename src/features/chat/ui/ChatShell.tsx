import clsx from "clsx";
import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { PopupTitlebar } from "@/features/popup-window";

interface ChatShellProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  /** Fill the parent instead of the viewport (Comm shell tabs). */
  embedded?: boolean;
}

export function ChatShell({ title, children, footer, icon, embedded }: ChatShellProps) {
  return (
    <div
      className={clsx(
        "flex flex-col w-full overflow-hidden bg-base-200 font-sans text-base-content",
        embedded ? "h-full" : "h-screen",
      )}
    >
      {embedded ? null : (
        <PopupTitlebar title={title} icon={icon ?? <MessageCircle className="w-4 h-4" />} accent="emerald" />
      )}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
      {footer ? <div className="shrink-0 border-t border-base-300 bg-base-100">{footer}</div> : null}
    </div>
  );
}
