import { useAtom, useAtomValue } from "jotai";
import { Download, Palette, RefreshCw, Type, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  activeCustomThemeAtom,
  applyThemeToDocument,
  BUILTIN_PRESETS,
  type BundledFontId,
  type CustomTheme,
  customThemesAtom,
  DEFAULT_DARK_THEME,
  exportThemeToJson,
  parseAndValidateThemeJson,
  themeAtom,
} from "@/entities/app";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/card";
import { toastError, toastInfo, toastSuccess } from "@/shared/ui/toast";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";

const BUNDLED_FONTS: Array<{ id: BundledFontId; name: string; sample: string }> = [
  { id: "system", name: "System Default (OS)", sample: "Aa 가나다 123" },
  { id: "inter", name: "Inter (Modern UI)", sample: "Aa 가나다 123" },
  { id: "geist", name: "Geist (Clean)", sample: "Aa 가나다 123" },
  { id: "jetbrains-mono", name: "JetBrains Mono (Code)", sample: "const x = 42;" },
  { id: "noto-sans-kr", name: "Noto Sans KR (Korean)", sample: "Aa 가나다 123" },
];

const POPULAR_SYSTEM_FONTS = [
  "Pretendard",
  "NanumGothic",
  "NanumBarunGothic",
  "Malgun Gothic",
  "Apple SD Gothic Neo",
  "Segoe UI",
  "Roboto",
];

function ColorPickerBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium text-base-content/50 truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-6 h-6 rounded border-none cursor-pointer bg-transparent shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input input-xs input-bordered bg-base-100 font-mono text-[10px] w-full px-1 text-center"
        />
      </div>
    </label>
  );
}

export function ThemeEditorPanel({ lang }: { lang: "ko" | "en" }) {
  const t = lang === "ko" ? ko : en;
  const [, setActiveThemeId] = useAtom(themeAtom);
  const [customThemes, setCustomThemes] = useAtom(customThemesAtom);
  const activeTheme = useAtomValue(activeCustomThemeAtom);
  const activeThemeRef = useRef(activeTheme);
  activeThemeRef.current = activeTheme;

  const [draft, setDraft] = useState<CustomTheme>(() => ({
    ...activeTheme,
    colors: {
      ...(activeTheme?.colors || {}),
      primaryContent: activeTheme?.colors?.primaryContent || (activeTheme?.base === "light" ? "#ffffff" : "#020617"),
      secondaryContent:
        activeTheme?.colors?.secondaryContent || (activeTheme?.base === "light" ? "#ffffff" : "#020617"),
      accentContent: activeTheme?.colors?.accentContent || (activeTheme?.base === "light" ? "#ffffff" : "#020617"),
    },
  }));
  const [fontQuery, setFontQuery] = useState("");

  useEffect(() => {
    if (!activeTheme) {
      return;
    }
    setDraft({
      ...activeTheme,
      colors: {
        ...(activeTheme.colors || {}),
        primaryContent: activeTheme.colors?.primaryContent || (activeTheme.base === "light" ? "#ffffff" : "#020617"),
        secondaryContent:
          activeTheme.colors?.secondaryContent || (activeTheme.base === "light" ? "#ffffff" : "#020617"),
        accentContent: activeTheme.colors?.accentContent || (activeTheme.base === "light" ? "#ffffff" : "#020617"),
      },
    });
  }, [activeTheme]);

  useEffect(() => {
    applyThemeToDocument(draft);
  }, [draft]);

  useEffect(() => {
    return () => {
      applyThemeToDocument(activeThemeRef.current);
    };
  }, []);

  const handleColorChange = (key: keyof CustomTheme["colors"], value: string) => {
    setDraft((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        [key]: value,
      },
    }));
  };

  const handleSaveTheme = () => {
    const isBuiltin = BUILTIN_PRESETS.some((p) => p.id === draft.id);
    let themeToSave = draft;

    if (isBuiltin) {
      themeToSave = {
        ...draft,
        id: `custom-theme-${Date.now()}`,
        name: `${draft.name} (Custom)`,
      };
    }

    setCustomThemes((prev) => {
      const exists = prev.some((item) => item.id === themeToSave.id);
      if (exists) {
        return prev.map((item) => (item.id === themeToSave.id ? themeToSave : item));
      }
      return [...prev, themeToSave];
    });

    setActiveThemeId(themeToSave.id);
    toastSuccess(t.saved);
  };

  const handleExportTheme = () => {
    const jsonStr = exportThemeToJson(draft);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.name.toLowerCase().replace(/\s+/g, "-")}.hgtheme.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess(t.exported);
  };

  const handleImportTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const { theme, warning, error } = parseAndValidateThemeJson(content);
      if (error) {
        toastError(error);
        return;
      }
      if (theme) {
        setCustomThemes((prev) => [...prev.filter((item) => item.id !== theme.id), theme]);
        setActiveThemeId(theme.id);
        if (warning) {
          toastInfo(warning);
        } else {
          toastSuccess(t.imported);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleResetToDefault = () => {
    setDraft(DEFAULT_DARK_THEME);
    setActiveThemeId(DEFAULT_DARK_THEME.id);
    toastInfo(t.resetDone);
  };

  return (
    <div className="flex flex-col gap-6 p-6 w-full min-w-0">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-base-300 pb-4">
        <div className="flex items-center gap-2.5">
          <Palette className="w-5 h-5 text-primary" />
          <h2 className="text-base font-bold text-base-content">{t.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="btn btn-xs btn-ghost gap-1 cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-info" />
            <span>{t.import}</span>
            <input type="file" accept=".json,.hgtheme.json" className="hidden" onChange={handleImportTheme} />
          </label>
          <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={handleExportTheme}>
            <Download className="w-3.5 h-3.5 text-accent" />
            {t.export}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={handleResetToDefault}>
            <RefreshCw className="w-3.5 h-3.5" />
            {t.reset}
          </Button>
          <Button variant="primary" size="sm" className="h-7 text-xs" onClick={handleSaveTheme}>
            {t.save}
          </Button>
        </div>
      </div>

      {/* Preset / Custom Selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-base-content/70">{t.selectTheme}</span>
        <select
          value={draft.id}
          onChange={(e) => {
            const targetId = e.target.value;
            const found =
              customThemes.find((item) => item.id === targetId) || BUILTIN_PRESETS.find((item) => item.id === targetId);
            if (found) {
              setDraft(found);
              setActiveThemeId(found.id);
            }
          }}
          className="select select-sm select-bordered bg-base-200 text-xs font-medium"
        >
          <optgroup label={t.builtin}>
            {BUILTIN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {customThemes.length > 0 && (
            <optgroup label={t.custom}>
              {customThemes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder={t.themeNamePlaceholder}
          className="input input-sm input-bordered bg-base-200 text-xs flex-1"
        />
      </div>

      {/* Colors Grid Grouped */}
      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-primary" />
          {t.colorGroups}
        </h2>

        <Card className="p-3 @min-[32rem]:p-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Primary Group */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: draft.colors.primary }} />
                Primary
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ColorPickerBox
                  label={t.background}
                  value={draft.colors.primary}
                  onChange={(v) => handleColorChange("primary", v)}
                />
                <ColorPickerBox
                  label={t.textColor}
                  value={draft.colors.primaryContent || "#ffffff"}
                  onChange={(v) => handleColorChange("primaryContent", v)}
                />
              </div>
            </div>

            {/* Secondary Group */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: draft.colors.secondary }} />
                Secondary
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ColorPickerBox
                  label={t.background}
                  value={draft.colors.secondary}
                  onChange={(v) => handleColorChange("secondary", v)}
                />
                <ColorPickerBox
                  label={t.textColor}
                  value={draft.colors.secondaryContent || "#ffffff"}
                  onChange={(v) => handleColorChange("secondaryContent", v)}
                />
              </div>
            </div>

            {/* Accent Group */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: draft.colors.accent }} />
                Accent
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ColorPickerBox
                  label={t.background}
                  value={draft.colors.accent}
                  onChange={(v) => handleColorChange("accent", v)}
                />
                <ColorPickerBox
                  label={t.textColor}
                  value={draft.colors.accentContent || "#ffffff"}
                  onChange={(v) => handleColorChange("accentContent", v)}
                />
              </div>
            </div>

            {/* Base & Surface Group */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full border border-base-content/40 shrink-0"
                  style={{ backgroundColor: draft.colors.base100 }}
                />
                {t.baseAndContent}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <ColorPickerBox
                  label={t.contentText}
                  value={draft.colors.content}
                  onChange={(v) => handleColorChange("content", v)}
                />
                <ColorPickerBox
                  label={t.panel100}
                  value={draft.colors.base100}
                  onChange={(v) => handleColorChange("base100", v)}
                />
                <ColorPickerBox
                  label={t.app200}
                  value={draft.colors.base200}
                  onChange={(v) => handleColorChange("base200", v)}
                />
                <ColorPickerBox
                  label={t.border300}
                  value={draft.colors.base300}
                  onChange={(v) => handleColorChange("base300", v)}
                />
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Typography Section */}
      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content flex items-center gap-1.5">
          <Type className="w-3.5 h-3.5 text-accent" />
          {t.typography}
        </h2>

        <Card className="p-3 @min-[32rem]:p-4 space-y-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bundled Fonts */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content">{t.bundledFonts}</h3>
              <div className="flex flex-col gap-1">
                {BUNDLED_FONTS.map((font) => {
                  const isSelected =
                    draft.typography.fontSource.type === "bundled" && draft.typography.fontSource.id === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          typography: {
                            ...prev.typography,
                            fontSource: { type: "bundled", id: font.id },
                          },
                        }))
                      }
                      className={`flex items-center justify-between p-2 rounded-lg text-xs text-left transition-colors ${
                        isSelected
                          ? "bg-primary/15 text-primary border border-primary/30 font-semibold"
                          : "hover:bg-base-200 text-base-content/80"
                      }`}
                    >
                      <span>{font.name}</span>
                      <span className="font-mono text-[10px] opacity-60">{font.sample}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* OS System Fonts */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-xs font-semibold text-base-content">{t.systemFonts}</h3>
              <input
                type="text"
                value={fontQuery}
                onChange={(e) => setFontQuery(e.target.value)}
                placeholder={t.fontSearch}
                className="input input-xs input-bordered bg-base-100 text-xs mb-1"
              />
              <div className="max-h-40 overflow-y-auto flex flex-col gap-1 pr-1">
                {POPULAR_SYSTEM_FONTS.filter(
                  (f) => !fontQuery || f.toLowerCase().includes(fontQuery.toLowerCase()),
                ).map((fontFamily) => {
                  const isSelected =
                    draft.typography.fontSource.type === "system" &&
                    draft.typography.fontSource.familyName === fontFamily;
                  return (
                    <button
                      key={fontFamily}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          typography: {
                            ...prev.typography,
                            fontSource: { type: "system", familyName: fontFamily },
                          },
                        }))
                      }
                      className={`flex items-center justify-between p-2 rounded-lg text-xs text-left transition-colors ${
                        isSelected
                          ? "bg-primary/15 text-primary border border-primary/30 font-semibold"
                          : "hover:bg-base-200 text-base-content/80"
                      }`}
                    >
                      <span>{fontFamily}</span>
                      <span style={{ fontFamily: `local("${fontFamily}"), sans-serif` }} className="text-xs">
                        Aa 가나다 123
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Font Size & Line Height Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-base-200">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium text-base-content/80">
                <span>{t.baseFontSize}</span>
                <span className="font-mono">{draft.typography.baseFontSize}px</span>
              </div>
              <input
                type="range"
                min="12"
                max="18"
                step="1"
                value={draft.typography.baseFontSize}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    typography: { ...prev.typography, baseFontSize: Number(e.target.value) },
                  }))
                }
                className="range range-xs range-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-medium text-base-content/80">
                <span>{t.lineHeight}</span>
                <span className="font-mono">{draft.typography.lineHeight}</span>
              </div>
              <input
                type="range"
                min="1.2"
                max="1.8"
                step="0.1"
                value={draft.typography.lineHeight}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    typography: { ...prev.typography, lineHeight: Number(e.target.value) },
                  }))
                }
                className="range range-xs range-accent"
              />
            </div>
          </div>
        </Card>
      </section>

      {/* Live Preview Card */}
      <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-semibold text-base-content">{t.livePreview}</h2>
        <Card className="p-4 space-y-3 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm px-3"
              style={{
                backgroundColor: draft.colors.primary,
                color: draft.colors.primaryContent || "#ffffff",
                borderColor: draft.colors.primary,
              }}
            >
              Primary Button
            </button>
            <button
              type="button"
              className="btn btn-sm px-3"
              style={{
                backgroundColor: draft.colors.secondary,
                color: draft.colors.secondaryContent || "#ffffff",
                borderColor: draft.colors.secondary,
              }}
            >
              Secondary Button
            </button>
            <span
              className="badge badge-sm font-semibold"
              style={{
                backgroundColor: draft.colors.accent,
                color: draft.colors.accentContent || "#ffffff",
                borderColor: draft.colors.accent,
              }}
            >
              Accent Badge
            </span>
          </div>

          <div className="text-xs leading-relaxed space-y-1">
            <p className="font-semibold">{t.livePreviewTitle}</p>
            <p className="text-base-content/55">{t.livePreviewBody}</p>
          </div>
        </Card>
      </section>
    </div>
  );
}
