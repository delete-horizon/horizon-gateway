import { useAtomValue } from "jotai";
import {
  Activity,
  BookOpen,
  Camera,
  Database,
  FileCode,
  GitBranch,
  History,
  Lock,
  Play,
  SlidersHorizontal,
  Terminal,
  Tv,
  Workflow,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { languageAtom } from "@/entities/app";
import { Button } from "@/shared/ui/button/Button";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import type { HubSurfaceId } from "../types";

function surfaceLabel(id: HubSurfaceId, t: typeof ko): string {
  switch (id) {
    case "global/pipeline":
      return t.toolsPipeline;
    case "global/crypto":
      return t.toolsCrypto;
    case "global/preview":
      return t.toolsPreview;
    case "global/api-client":
      return t.toolsApiClient;
    case "global/api-logs":
      return t.toolsApiLogs;
    case "global/mocking":
      return t.toolsApiMocking;
    case "global/json-schema":
      return t.toolsJsonSchema;
    case "global/schema-explorer":
      return t.toolsApiSchema;
    case "global/server-logs":
      return t.toolsServerLogs;
    case "global/proxy-graph":
      return t.toolsProxyGraph;
    case "global/monitor":
      return t.toolsMonitor;
    case "global/policies":
      return t.toolsPolicies;
    case "global/live-capture":
      return t.toolsLiveCapture;
    case "global/monitor-logs":
      return t.toolsMonitorLogs;
    default:
      return id;
  }
}

function surfaceIcon(id: HubSurfaceId) {
  switch (id) {
    case "global/api-client":
      return Play;
    case "global/api-logs":
      return History;
    case "global/mocking":
      return SlidersHorizontal;
    case "global/json-schema":
      return FileCode;
    case "global/schema-explorer":
      return Database;
    case "global/pipeline":
      return GitBranch;
    case "global/crypto":
      return Lock;
    case "global/preview":
      return Tv;
    case "global/live-capture":
      return Camera;
    case "global/proxy-graph":
      return Workflow;
    case "global/monitor":
      return Activity;
    case "global/server-logs":
      return Terminal;
    case "global/policies":
      return BookOpen;
    default:
      return Wrench;
  }
}

interface ToolGroup {
  labelKey: "toolsCategoryApi" | "toolsCategorySandbox" | "toolsCategoryNetwork";
  items: HubSurfaceId[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    labelKey: "toolsCategoryApi",
    items: ["global/api-client", "global/api-logs", "global/mocking", "global/json-schema", "global/schema-explorer"],
  },
  {
    labelKey: "toolsCategorySandbox",
    items: ["global/pipeline", "global/crypto", "global/preview", "global/live-capture"],
  },
  {
    labelKey: "toolsCategoryNetwork",
    items: ["global/proxy-graph", "global/monitor", "global/server-logs", "global/policies"],
  },
];

interface ToolsMenuProps {
  onOpenTool: (id: HubSurfaceId) => void;
}

export function ToolsMenu({ onOpenTool }: ToolsMenuProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 h-8 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t.tools}</span>
      </Button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label={t.handoffCloseMenu}
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl py-1.5 px-1">
            {TOOL_GROUPS.map((group, groupIdx) => (
              <div key={group.labelKey}>
                {groupIdx > 0 && <div className="my-1.5 border-t border-slate-800" />}
                <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t[group.labelKey]}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((id) => {
                    const Icon = surfaceIcon(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className="w-full px-2.5 py-1.5 text-left text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800/90 rounded-lg flex items-center gap-2.5 transition-colors"
                        onClick={() => {
                          onOpenTool(id);
                          setOpen(false);
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span>{surfaceLabel(id, t)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
