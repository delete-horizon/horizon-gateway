import { AnimatePresence, motion } from "framer-motion";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppTheme, languageAtom, openWorkspaceCompanion, proxyRunningAtom, themeAtom } from "@/entities/app";
import { fetchDomains } from "@/entities/domain";
import { getMockRules, getScenarios, setScenarioEnabled } from "@/entities/mocking";
import { bugReportModalOpenAtom } from "@/features/bug-report";
import { type HubSurfaceId, type PanelId, usePanelNavigation } from "@/features/panel-stack";
import type { Domain } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import { toastError, toastInfo, toastSuccess } from "@/shared/ui/toast";
import { createPaletteCommands } from "../lib/commands";
import { filterCommands, filterOptions } from "../lib/useFuzzyFilter";
import {
  commandPaletteOpenAtom,
  paletteHighlightIndexAtom,
  paletteQueryAtom,
  paletteSessionAtom,
  paletteStepQueryAtom,
  recentCommandIdsAtom,
} from "../store";
import type { PaletteCommandDef, PaletteOption, PaletteStepDef } from "../types";
import { PaletteBreadcrumb } from "./PaletteBreadcrumb";
import { PaletteFooter } from "./PaletteFooter";
import { PaletteItem } from "./PaletteItem";

export function CommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [query, setQuery] = useAtom(paletteQueryAtom);
  const [session, setSession] = useAtom(paletteSessionAtom);
  const [stepQuery, setStepQuery] = useAtom(paletteStepQueryAtom);
  const [highlightIndex, setHighlightIndex] = useAtom(paletteHighlightIndexAtom);
  const [recents, setRecents] = useAtom(recentCommandIdsAtom);

  const lang = useAtomValue(languageAtom);
  const setTheme = useSetAtom(themeAtom);
  const setBugReportOpen = useSetAtom(bugReportModalOpenAtom);
  const proxyRunning = useAtomValue(proxyRunningAtom);
  const nav = usePanelNavigation();

  const inputRef = useRef<HTMLInputElement>(null);
  const [asyncOptions, setAsyncOptions] = useState<PaletteOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const handlers = useMemo(
    () => ({
      getDomains: async () => {
        const doms = await fetchDomains();
        return doms.map((d: Domain) => ({ id: d.id, url: d.url, name: d.url }));
      },
      getMockRules: async () => {
        const rules = await getMockRules();
        return rules.map((r) => ({ id: r.id, name: r.name, urlPattern: r.url_pattern }));
      },
      getScenarios: async () => {
        const scens = await getScenarios();
        return scens.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));
      },
      onSelectDomain: (id: number) => {
        nav.selectDomain(id);
      },
      onOpenDomainPanel: (id: number, panelId: string) => {
        nav.selectDomain(id);
        nav.openPanel(panelId as PanelId);
      },
      onEditMockRule: (ruleId: string) => {
        toastInfo(`Opening mock rule ${ruleId}`);
      },
      onActivateScenario: async (scenarioId: string) => {
        await setScenarioEnabled(scenarioId, true);
        toastSuccess(lang === "ko" ? "시나리오가 활성화되었습니다." : "Scenario activated.");
      },
      onToggleProxy: async () => {
        if (proxyRunning) {
          await commands.stopLocalProxy().then(unwrap);
          toastInfo("Proxy Stopped");
        } else {
          await commands.startLocalProxy(null).then(unwrap);
          toastInfo("Proxy Started");
        }
      },
      onClearApiLogs: async () => {
        const today = new Date().toISOString().split("T")[0];
        await commands.clearApiLogs({ date: today }).then(unwrap);
        toastSuccess("API Logs Cleared");
      },
      onExportRootCa: async () => {
        await commands.saveRootCa().then(unwrap);
        toastSuccess("Root CA Saved");
      },
      onOpenTeamSync: () => {
        void openWorkspaceCompanion().then((error) => {
          if (error) {
            toastError(error);
          }
        });
      },
      onOpenAvatarStudio: () => {
        void openWorkspaceCompanion("avatar").then((error) => {
          if (error) {
            toastError(error);
          }
        });
      },
      onOpenThemeEditor: () => {
        nav.openGlobalSurface("chrome/theme");
      },
      onOpenGlobalSurface: (surfaceId: string) => {
        nav.openGlobalSurface(surfaceId as HubSurfaceId);
      },
      onOpenSettings: () => {
        nav.openGlobalSurface("chrome/settings");
      },
      onExportAllSettings: async () => {
        try {
          const res = await commands.exportAllSettings().then(unwrap);
          if (res.success && res.data) {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { writeTextFile } = await import("@tauri-apps/plugin-fs");
            const path = await save({
              filters: [{ name: "Horizon Gateway Settings", extensions: ["hg.json", "json"] }],
              defaultPath: `horizon-gateway-${new Date().toISOString().slice(0, 10)}.hg.json`,
            });
            if (path) {
              await writeTextFile(path, JSON.stringify(res.data, null, 2));
              toastSuccess("Settings Exported");
            }
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          toastError(`Export failed: ${message}`);
        }
      },
      onImportAllSettings: async () => {
        nav.openGlobalSurface("chrome/settings");
      },
      onSwitchTheme: (newTheme: string) => {
        setTheme(newTheme as AppTheme);
      },
      onSwitchLanguage: (newLang: "ko" | "en") => {
        toastInfo(`Language set to ${newLang}`);
      },
      onOpenBugReport: () => {
        setOpen(false);
        setBugReportOpen(true);
      },
    }),
    [nav, proxyRunning, setOpen, setBugReportOpen, setTheme, lang],
  );

  const commandsList = useMemo(() => createPaletteCommands(handlers), [handlers]);

  const currentStep: PaletteStepDef | undefined = useMemo(() => {
    if (!session) {
      return undefined;
    }
    return session.command.steps?.[session.stepIndex];
  }, [session]);

  // Load step options only ONCE when step changes (prevents IPC calls on every keystroke)
  useEffect(() => {
    if (!currentStep) {
      setAsyncOptions([]);
      return;
    }

    if (currentStep.type === "select") {
      setAsyncOptions(currentStep.options);
    } else if (currentStep.type === "autocomplete") {
      setLoadingOptions(true);
      Promise.resolve(currentStep.getOptions(""))
        .then((opts) => setAsyncOptions(opts))
        .catch(console.error)
        .finally(() => setLoadingOptions(false));
    }
  }, [currentStep]);

  // Filter commands or step options in-memory instantly
  const filteredCommands = useMemo(() => {
    if (session) {
      return [];
    }
    return filterCommands(commandsList, query, lang, recents);
  }, [session, commandsList, query, lang, recents]);

  const filteredStepOptions = useMemo(() => {
    if (!currentStep || currentStep.type === "input") {
      return [];
    }
    return filterOptions(asyncOptions, stepQuery);
  }, [currentStep, asyncOptions, stepQuery]);

  const maxIndex = session ? filteredStepOptions.length - 1 : filteredCommands.length - 1;

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Ensure focus when opening or changing session
  useEffect(() => {
    if (open) {
      focusInput();
    }
  }, [open, focusInput]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSession(null);
    setQuery("");
    setStepQuery("");
    setHighlightIndex(0);
  }, [setOpen, setSession, setQuery, setStepQuery, setHighlightIndex]);

  const executeCommand = useCallback(
    async (cmd: PaletteCommandDef, values: Record<string, string>) => {
      // Add to recents
      setRecents((prev) => [cmd.id, ...prev.filter((id) => id !== cmd.id)].slice(0, 5));

      try {
        const result = await cmd.action(values);
        if (typeof result === "string") {
          toastSuccess(result);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toastError(msg || "Command failed");
      } finally {
        handleClose();
      }
    },
    [handleClose, setRecents],
  );

  const handleSelectCommand = useCallback(
    (cmd: PaletteCommandDef) => {
      if (!cmd.steps || cmd.steps.length === 0) {
        void executeCommand(cmd, {});
      } else {
        setSession({
          command: cmd,
          stepIndex: 0,
          values: {},
        });
        setStepQuery("");
        setHighlightIndex(0);
        focusInput();
      }
    },
    [executeCommand, focusInput, setHighlightIndex, setSession, setStepQuery],
  );

  const handleNextStep = useCallback(
    (selectedValue?: string) => {
      if (!session || !currentStep) {
        return;
      }

      let val = selectedValue;
      if (val === undefined && currentStep.type === "input") {
        val = stepQuery.trim();
        if (currentStep.validate) {
          const err = currentStep.validate(val);
          if (err) {
            toastError(err);
            return;
          }
        }
      }

      if (val === undefined) {
        return;
      }

      const newValues = { ...session.values, [currentStep.id]: val };
      const nextStepIndex = session.stepIndex + 1;

      if (session.command.steps && nextStepIndex < session.command.steps.length) {
        setSession({
          ...session,
          stepIndex: nextStepIndex,
          values: newValues,
        });
        setStepQuery("");
        setHighlightIndex(0);
        focusInput();
      } else {
        void executeCommand(session.command, newValues);
      }
    },
    [session, currentStep, stepQuery, executeCommand, focusInput, setHighlightIndex, setSession, setStepQuery],
  );

  const handleBack = useCallback(() => {
    if (!session) {
      return;
    }

    if (session.stepIndex > 0) {
      setSession({
        ...session,
        stepIndex: session.stepIndex - 1,
      });
      setStepQuery("");
      setHighlightIndex(0);
      focusInput();
    } else {
      setSession(null);
      setStepQuery("");
      setHighlightIndex(0);
      focusInput();
    }
  }, [session, focusInput, setHighlightIndex, setSession, setStepQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) => (prev < maxIndex ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, maxIndex)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (session) {
          if (currentStep?.type === "input") {
            handleNextStep();
          } else if (filteredStepOptions[highlightIndex]) {
            handleNextStep(filteredStepOptions[highlightIndex].value);
          }
        } else if (filteredCommands[highlightIndex]) {
          handleSelectCommand(filteredCommands[highlightIndex]);
        }
      } else if (e.key === "Backspace" && (session ? stepQuery === "" : query === "")) {
        if (session) {
          e.preventDefault();
          handleBack();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (session) {
          handleBack();
        } else {
          handleClose();
        }
      }
    },
    [
      maxIndex,
      session,
      currentStep,
      stepQuery,
      query,
      highlightIndex,
      filteredStepOptions,
      filteredCommands,
      handleNextStep,
      handleSelectCommand,
      handleBack,
      handleClose,
      setHighlightIndex,
    ],
  );

  if (!open) {
    return null;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-start justify-center pt-20 px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 bg-base-200/75"
          onClick={handleClose}
        />

        {/* Command Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -10 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-xl bg-base-100 border border-base-300 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-10"
        >
          {session && (
            <PaletteBreadcrumb
              command={session.command}
              currentStep={currentStep}
              stepIndex={session.stepIndex}
              totalSteps={session.command.steps?.length || 0}
              lang={lang}
            />
          )}

          {/* Search Input Box */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-base-300">
            <Search className="w-4 h-4 text-base-content/40 shrink-0" />
            <input
              ref={inputRef}
              type={currentStep?.type === "input" ? currentStep.inputType || "text" : "text"}
              value={session ? stepQuery : query}
              onChange={(e) => (session ? setStepQuery(e.target.value) : setQuery(e.target.value))}
              onKeyDown={handleKeyDown}
              placeholder={
                session
                  ? currentStep?.placeholder?.[lang] || currentStep?.placeholder?.en || "Type or select..."
                  : lang === "ko"
                    ? "명령어 검색 (Ctrl+P)..."
                    : "Type a command or search (Ctrl+P)..."
              }
              className="flex-1 bg-transparent border-none outline-none text-sm text-base-content placeholder:text-base-content/40"
              autoFocus
            />
          </div>

          {/* Items / Options List */}
          <div className="max-h-80 overflow-y-auto p-2 flex flex-col gap-1">
            {!session &&
              filteredCommands.map((cmd, i) => (
                <PaletteItem
                  key={cmd.id}
                  id={cmd.id}
                  icon={cmd.icon}
                  label={cmd.meta.label[lang] || cmd.meta.label.en}
                  description={cmd.meta.description?.[lang] || cmd.meta.description?.en}
                  isSelected={i === highlightIndex}
                  onSelect={() => handleSelectCommand(cmd)}
                  onMouseEnter={() => setHighlightIndex(i)}
                  kbdHint={recents.includes(cmd.id) ? (lang === "ko" ? "최근" : "Recent") : undefined}
                />
              ))}

            {session &&
              filteredStepOptions.map((opt, i) => (
                <PaletteItem
                  key={opt.value}
                  id={opt.value}
                  icon={opt.icon}
                  label={opt.label}
                  description={opt.description}
                  isSelected={i === highlightIndex}
                  onSelect={() => handleNextStep(opt.value)}
                  onMouseEnter={() => setHighlightIndex(i)}
                />
              ))}

            {!session && filteredCommands.length === 0 && (
              <div className="p-6 text-center text-xs text-base-content/50">
                {lang === "ko" ? "일치하는 명령어가 없습니다." : "No matching commands found."}
              </div>
            )}

            {session && currentStep?.type !== "input" && filteredStepOptions.length === 0 && (
              <div className="p-6 text-center text-xs text-base-content/50">
                {loadingOptions
                  ? lang === "ko"
                    ? "옵션 불러오는 중..."
                    : "Loading options..."
                  : lang === "ko"
                    ? "선택 가능한 옵션이 없습니다."
                    : "No available options."}
              </div>
            )}
          </div>

          <PaletteFooter lang={lang} hasSession={Boolean(session)} />
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
