import * as Babel from "@babel/standalone";
import { useAtom, useAtomValue } from "jotai";
import { AlertCircle, Check, Copy, Play, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { languageAtom, themeAtom } from "@/entities/app";
import {
  type SavedComponent,
  savedComponentsAtom,
  savedJsonSchemasAtom,
  selectedComponentIdAtom,
  validateJsonSchema,
} from "@/entities/sandbox";
import { toastInfo } from "@/shared/ui/toast";
import { TsCodeEditor } from "@/shared/ui/ts-code-editor/TsCodeEditor";
import { en as previewEn } from "../i18n/preview-en";
import { ko as previewKo } from "../i18n/preview-ko";
import { SchemaEditorModal } from "./SchemaEditorModal";

export interface LivePreviewerProps {
  initialData?: unknown;
  code?: string;
  schemaText?: string;
}

export function LivePreviewer({ initialData, code: propCode, schemaText }: LivePreviewerProps) {
  const theme = useAtomValue(themeAtom);
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? previewKo : previewEn;
  // Standalone CRUD atoms
  const [savedComponents, setSavedComponents] = useAtom(savedComponentsAtom);
  const [selectedId, setSelectedId] = useAtom(selectedComponentIdAtom);
  const savedSchemas = useAtomValue(savedJsonSchemasAtom);

  const [searchQuery, setSearchQuery] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  // Active selected component
  const activeComponent = useMemo(() => {
    return savedComponents.find((c) => c.id === selectedId) || savedComponents[0] || null;
  }, [savedComponents, selectedId]);

  // Sync selected component ID fallback
  useEffect(() => {
    if (activeComponent && activeComponent.id !== selectedId) {
      setSelectedId(activeComponent.id);
    }
  }, [activeComponent, selectedId, setSelectedId]);

  // Local editor states
  const [editedCode, setEditedCode] = useState("");
  const [editedMockData, setEditedMockData] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedDesc, setEditedDesc] = useState("");
  const [editedSchemaId, setEditedSchemaId] = useState("");

  const [compileError, setCompileError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string | null>(null);
  const [iframeSrcDoc, setIframeSrcDoc] = useState("");

  // Modal states for Schema Editor
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [schemaModalTargetId, setSchemaModalTargetId] = useState<string | undefined>(undefined);

  const handleOpenSchemaModal = (isNew: boolean) => {
    setSchemaModalTargetId(isNew ? undefined : editedSchemaId);
    setIsSchemaModalOpen(true);
  };

  const handleSchemaSaved = (savedId: string) => {
    setEditedSchemaId(savedId);
  };

  // Sync editors when switching active component (only when standalone)
  useEffect(() => {
    if (propCode === undefined && activeComponent) {
      setEditedCode(activeComponent.code);
      setEditedMockData(activeComponent.mockData);
      setEditedName(activeComponent.name);
      setEditedDesc(activeComponent.description);
      setEditedSchemaId(activeComponent.schemaId || "");
    }
  }, [activeComponent, propCode]);

  // Source inputs selector based on mode
  const codeToCompile = propCode !== undefined ? propCode : editedCode;

  // Filtered components list for search
  const filteredComponents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      return savedComponents;
    }
    return savedComponents.filter(
      (c) => c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query),
    );
  }, [savedComponents, searchQuery]);

  // Determine active schema text for validation
  const activeSchemaText = useMemo(() => {
    if (propCode !== undefined) {
      return schemaText || "";
    }
    const found = savedSchemas.find((s) => s.id === editedSchemaId);
    return found ? found.schemaText : "";
  }, [editedSchemaId, savedSchemas, propCode, schemaText]);

  // Context object for Monaco editor autocompletion (props path autocomplete)
  const mockDataObj = useMemo(() => {
    try {
      return JSON.parse(editedMockData || "{}");
    } catch {
      // Fallback: parse fields from active schema if JSON is invalid or empty
      try {
        const schemaObj = JSON.parse(activeSchemaText || "{}");
        const fallback: Record<string, unknown> = {};
        if (schemaObj && typeof schemaObj.properties === "object") {
          Object.keys(schemaObj.properties).forEach((k) => {
            fallback[k] = "";
          });
        }
        return fallback;
      } catch {
        return {};
      }
    }
  }, [editedMockData, activeSchemaText]);

  const editorContext = useMemo(() => {
    return { props: mockDataObj };
  }, [mockDataObj]);

  // Standalone suggestions for destructured props (e.g. { title, message })
  const componentCustomSuggestions = useMemo(() => {
    return Object.keys(mockDataObj).map((key) => ({
      label: key,
      insertText: key,
      detail: `prop (${typeof mockDataObj[key]})`,
    }));
  }, [mockDataObj]);

  // Custom suggestions for JSON mock data keys based on active schema properties
  const jsonCustomSuggestions = useMemo(() => {
    try {
      const schemaObj = JSON.parse(activeSchemaText || "{}");
      if (schemaObj && typeof schemaObj.properties === "object") {
        return Object.keys(schemaObj.properties).map((key) => ({
          label: `"${key}"`,
          insertText: `"${key}": `,
          detail: `schema: ${schemaObj.properties[key].type || "any"}`,
        }));
      }
    } catch {
      // ignore
    }
    return [];
  }, [activeSchemaText]);

  // Real-time JSON Schema Validation
  useEffect(() => {
    let active = true;
    if (!activeSchemaText) {
      setValidationErrors(null);
      return;
    }

    const runValidation = async () => {
      try {
        let payloadStr = "";
        if (propCode !== undefined) {
          payloadStr = JSON.stringify(initialData || {});
        } else {
          // Check JSON syntax first
          try {
            JSON.parse(editedMockData || "{}");
            payloadStr = editedMockData || "{}";
          } catch {
            return; // Let compiler handle syntax error
          }
        }

        const res = await validateJsonSchema(payloadStr, activeSchemaText);
        if (active) {
          if (res.valid) {
            setValidationErrors(null);
          } else {
            setValidationErrors(res.errors || "JSON Schema validation failed");
          }
        }
      } catch (err: unknown) {
        if (active) {
          const message = err instanceof Error ? err.message : String(err);
          setValidationErrors(message || "Schema validation error");
        }
      }
    };

    runValidation();
    return () => {
      active = false;
    };
  }, [activeSchemaText, editedMockData, initialData, propCode]);

  // Compile and load to iframe
  const handleRender = useCallback(() => {
    setCompileError(null);
    if (!codeToCompile) {
      setIframeSrcDoc("");
      return;
    }

    try {
      // 1. Validate mock data JSON
      let parsedData = {};
      if (propCode !== undefined) {
        parsedData = initialData || {};
      } else {
        try {
          parsedData = JSON.parse(editedMockData || "{}");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          throw new Error(t.jsonParseError(message));
        }
      }

      // 2. Compile JSX/TSX code using Babel
      if (!codeToCompile.includes("export default")) {
        throw new Error(t.missingDefaultExport);
      }

      // Replace export default with window.GeneratedComponent assignment
      let cleanCode = codeToCompile
        .replace(/export\s+default\s+function\s+(\w+)/g, "function $1")
        .replace(/export\s+default\s+class\s+(\w+)/g, "class $1");

      if (cleanCode.includes("export default")) {
        // Handle export default anonymous function or variable reference
        cleanCode = cleanCode.replace(/export\s+default\s+/g, "window.GeneratedComponent = ");
      } else {
        // Extract default exported function name and assign at bottom
        const match = codeToCompile.match(/export\s+default\s+function\s+(\w+)/);
        if (match?.[1]) {
          cleanCode += `\nwindow.GeneratedComponent = ${match[1]};`;
        } else {
          // Try arrow functions / variables
          const varMatch = codeToCompile.match(/export\s+default\s+(\w+)/);
          if (varMatch?.[1]) {
            cleanCode += `\nwindow.GeneratedComponent = ${varMatch[1]};`;
          } else {
            throw new Error(t.defaultExportParseFailed);
          }
        }
      }

      // Transpile using Babel with classic React runtime and CommonJS module support
      const compiled = Babel.transform(cleanCode, {
        presets: [["react", { runtime: "classic" }], "typescript"],
        plugins: ["transform-modules-commonjs"],
        filename: "preview.tsx",
      }).code;

      if (!compiled) {
        throw new Error(t.emptyCompile);
      }

      // 3. Construct srcDoc with react, react-dom and tailwind injection
      const srcDoc = `
        <!DOCTYPE html>
        <html data-theme="${theme}">
          <head>
            <meta charset="utf-8">
            <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
            <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
            <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
            <style>
              [data-theme="horizon-gateway-light"] {
                --color-base-100: #ffffff;
                --color-base-200: #f8fafc;
                --color-base-300: #f1f5f9;
                --color-base-content: #0f172a;
                --color-primary: #3b82f6;
                --color-secondary: #4f46e5;
                --color-accent: #0ea5e9;
                --color-neutral: #1e293b;
                --color-info: #0ea5e9;
                --color-success: #10b981;
                --color-warning: #f59e0b;
                --color-error: #ef4444;
              }
              [data-theme="horizon-gateway-dark"] {
                --color-base-100: #0f172a;
                --color-base-200: #020617;
                --color-base-300: #1e293b;
                --color-base-content: #f8fafc;
                --color-primary: #60a5fa;
                --color-secondary: #818cf8;
                --color-accent: #38bdf8;
                --color-neutral: #1e293b;
                --color-info: #38bdf8;
                --color-success: #34d399;
                --color-warning: #fbbf24;
                --color-error: #f87171;
              }
              body {
                margin: 0;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                background-color: transparent;
              }
            </style>
            <style type="text/tailwindcss">
              @theme {
                --color-primary: var(--color-primary);
                --color-secondary: var(--color-secondary);
                --color-accent: var(--color-accent);
                --color-neutral: var(--color-neutral);
                --color-base-100: var(--color-base-100);
                --color-base-200: var(--color-base-200);
                --color-base-300: var(--color-base-300);
                --color-base-content: var(--color-base-content);
                --color-info: var(--color-info);
                --color-success: var(--color-success);
                --color-warning: var(--color-warning);
                --color-error: var(--color-error);
              }
            </style>
          </head>
          <body>
            <div id="root"></div>
            <script>
              // Set up CommonJS environment in global scope
              window.exports = {};
              window.module = { exports: window.exports };
              window.require = function(moduleName) {
                if (moduleName === 'react') return window.React;
                if (moduleName === 'react-dom') return window.ReactDOM;
                throw new Error(${JSON.stringify(t.moduleNotFound)} + moduleName);
              };

              const React = window.React;
              const ReactDOM = window.ReactDOM;
              const data = ${JSON.stringify(parsedData)};

              try {
                // Execute transpiled user code
                ${compiled}

                // Mount React component
                const container = document.getElementById('root');
                const root = ReactDOM.createRoot(container);
                
                const Component = window.GeneratedComponent || (window.exports && window.exports.default) || (window.module && window.module.exports);
                
                if (!Component) {
                  throw new Error(${JSON.stringify(t.componentNotFound)});
                }
                
                // Pass json fields directly as root props
                const props = (typeof data === 'object' && data !== null && !Array.isArray(data))
                  ? data
                  : {};
                
                root.render(React.createElement(Component, props));
              } catch (err) {
                document.getElementById('root').innerHTML = \`
                  <div style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); padding: 16px; border-radius: 8px; font-family: monospace; font-size: 13px;">
                    <h4 style="margin: 0 0 8px 0; font-weight: bold;">${t.renderErrorTitle}</h4>
                    \${err.message}
                  </div>
                \`;
              }
            </script>
          </body>
        </html>
      `;

      setIframeSrcDoc(srcDoc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setCompileError(message || "Compilation failed");
      setIframeSrcDoc("");
    }
  }, [codeToCompile, propCode, editedMockData, initialData, theme, t]);

  // Trigger render on source code or data change
  useEffect(() => {
    handleRender();
  }, [handleRender]);

  // CRUD handlers
  const handleCreateComponent = () => {
    const newId = `component_${Math.random().toString(36).substring(2, 9)}`;
    const newComponent: SavedComponent = {
      id: newId,
      name: `CustomComponent_${savedComponents.length + 1}`,
      description: t.newComponentDescription,
      code: `import React from 'react';

export default function Preview({ message }: Props) {
  const display = message || ${JSON.stringify(t.sampleGreeting)};
  return (
    <div className="p-6 bg-base-100 border border-base-300 rounded-xl shadow-md text-center max-w-sm mx-auto">
      <h3 className="text-lg font-bold text-primary">${t.sampleTitle}</h3>
      <p className="text-sm mt-2 text-base-content/70">{display}</p>
    </div>
  );
}`,
      mockData: JSON.stringify({ message: t.sampleGreeting }, null, 2),
      schemaId: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSavedComponents([...savedComponents, newComponent]);
    setSelectedId(newId);
  };

  const handleSaveComponent = () => {
    if (!activeComponent) {
      return;
    }

    const updated = savedComponents.map((c) => {
      if (c.id === activeComponent.id) {
        return {
          ...c,
          name: editedName.trim() || "UntitledComponent",
          description: editedDesc.trim(),
          code: editedCode,
          mockData: editedMockData,
          schemaId: editedSchemaId || undefined,
          updatedAt: Date.now(),
        };
      }
      return c;
    });

    setSavedComponents(updated);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDuplicateComponent = (c: SavedComponent, e: React.MouseEvent) => {
    e.stopPropagation();
    const newId = `component_${Math.random().toString(36).substring(2, 9)}`;
    const duplicated: SavedComponent = {
      ...c,
      id: newId,
      name: `${c.name}_Copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSavedComponents([...savedComponents, duplicated]);
    setSelectedId(newId);
  };

  const handleDeleteComponent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedComponents.length <= 1) {
      toastInfo(t.keepOne);
      return;
    }
    if (confirm(t.confirmDelete)) {
      const updated = savedComponents.filter((c) => c.id !== id);
      setSavedComponents(updated);
      if (selectedId === id) {
        setSelectedId(updated[0].id);
      }
    }
  };

  // Conditionally render ONLY the preview iframe if code was passed as a prop
  if (propCode !== undefined) {
    return (
      <div className="w-full h-full flex flex-col relative bg-white">
        {schemaText && validationErrors && (
          <div className="bg-error/10 border-b border-error/20 text-error px-3 py-1.5 font-mono text-[9px] shrink-0 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="flex-1 overflow-auto max-h-[60px] whitespace-pre-wrap leading-normal">
              <strong>{t.schemaValidationFailed}</strong> {validationErrors}
            </div>
          </div>
        )}
        <div className="flex-1 relative">
          {compileError ? (
            <div className="absolute inset-0 p-4 bg-error/5 text-error font-mono text-xs overflow-auto flex flex-col space-y-2">
              <span className="font-bold flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {t.compileError}
              </span>
              <pre className="whitespace-pre-wrap">{compileError}</pre>
            </div>
          ) : iframeSrcDoc ? (
            <iframe
              title="Live Render Sandbox"
              srcDoc={iframeSrcDoc}
              sandbox="allow-scripts"
              className="w-full h-full border-none bg-transparent"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-base-content/40 italic">
              {t.waitingCompile}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full h-[calc(100vh-14rem)] items-stretch">
        {/* Component List Pane (Left Side - 3 columns) */}
        <div className="lg:col-span-3 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
            <span className="font-bold text-xs text-base-content/70 flex items-center gap-1">{t.savedComponents}</span>
            <button
              className="btn btn-xs btn-primary btn-outline flex items-center gap-1"
              onClick={handleCreateComponent}
            >
              <Plus className="w-3.5 h-3.5" /> {t.add}
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-3 shrink-0">
            <Search className="w-3.5 h-3.5 text-base-content/40 absolute left-3 top-2.5" />
            <input
              type="text"
              className="input input-bordered input-sm w-full pl-8 text-xs focus:outline-none"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Component Items */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 select-none">
            {filteredComponents.map((c) => {
              const isActive = c.id === selectedId;
              return (
                <div
                  key={c.id}
                  className={`group p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-base-200 hover:bg-base-200/50 text-base-content/80"
                  }`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="truncate flex-1 min-w-0 mr-2">
                    <div className="font-bold truncate">{c.name}</div>
                    <div className="text-[10px] text-base-content/50 truncate font-normal mt-0.5">
                      {c.description || t.noDescription}
                    </div>
                  </div>
                  <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                    <button
                      className="btn btn-ghost btn-xs p-0 w-6 h-6 hover:bg-base-300 text-base-content/60"
                      title={t.duplicate}
                      onClick={(e) => handleDuplicateComponent(c, e)}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="btn btn-ghost btn-xs p-0 w-6 h-6 hover:bg-error/15 text-error/70"
                      title={t.delete}
                      onClick={(e) => handleDeleteComponent(c.id, e)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredComponents.length === 0 && (
              <div className="text-center py-8 text-xs text-base-content/40 italic">{t.emptyList}</div>
            )}
          </div>
        </div>

        {/* Code & Props Editors Panel (Middle - 5 columns) */}
        <div className="lg:col-span-5 flex flex-col h-full overflow-hidden">
          {/* Component Meta Panel */}
          <div className="bg-base-200/60 p-3 rounded-2xl border border-base-300 mb-3.5 flex flex-col gap-2 shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-end">
              <div>
                <label className="text-[9px] font-bold text-base-content/50 uppercase tracking-wider">
                  {t.componentName}
                </label>
                <input
                  type="text"
                  className="input input-bordered input-xs font-bold w-full mt-0.5 text-xs focus:outline-none"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[9px] font-bold text-base-content/50 uppercase tracking-wider">
                    {t.validationSchema}
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                      title={t.createSchema}
                      onClick={() => handleOpenSchemaModal(true)}
                    >
                      {t.createSchemaShort}
                    </button>
                    {editedSchemaId && (
                      <button
                        type="button"
                        className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                        title={t.editSchema}
                        onClick={() => handleOpenSchemaModal(false)}
                      >
                        {t.editSchemaShort}
                      </button>
                    )}
                  </div>
                </div>
                <select
                  className="select select-bordered select-xs w-full mt-0.5 text-xs font-semibold focus:outline-none"
                  value={editedSchemaId || ""}
                  onChange={(e) => setEditedSchemaId(e.target.value)}
                >
                  <option value="">{t.noSchema}</option>
                  {savedSchemas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button
                  className={`btn btn-xs btn-primary w-full flex items-center justify-center gap-1 font-bold ${
                    justSaved ? "btn-success" : ""
                  }`}
                  onClick={handleSaveComponent}
                  disabled={!activeComponent}
                >
                  {justSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {justSaved ? t.saved : t.save}
                </button>
              </div>
            </div>
            <div>
              <label className="text-[9px] font-bold text-base-content/50 uppercase tracking-wider">
                {t.description}
              </label>
              <input
                type="text"
                className="input input-bordered input-xs w-full mt-0.5 text-xs focus:outline-none"
                value={editedDesc}
                onChange={(e) => setEditedDesc(e.target.value)}
                placeholder={t.descriptionPlaceholder}
              />
            </div>
          </div>

          {/* React Component Editor */}
          <div className="flex-1 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col min-h-[220px] overflow-hidden mb-3.5">
            <div className="flex items-center justify-between border-b border-base-200 pb-2 mb-2 shrink-0">
              <span className="font-semibold text-xs text-base-content/70 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" /> React Component (TSX/JSX)
              </span>
              <button
                className="btn btn-xs btn-ghost btn-outline flex items-center gap-1 hover:bg-base-200"
                onClick={handleRender}
              >
                <Play className="w-3 h-3 text-primary" /> {t.render}
              </button>
            </div>
            <div className="flex-1 min-h-[350px]">
              <TsCodeEditor
                value={editedCode}
                onChange={setEditedCode}
                language="typescript"
                context={editorContext}
                customSuggestions={componentCustomSuggestions}
                theme={theme}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* Mock JSON Input */}
          <div className="h-[210px] card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-base-200 pb-2 mb-2 shrink-0">
              <span className="font-semibold text-xs text-base-content/70">{t.propsData}</span>
              {editedSchemaId &&
                (validationErrors ? (
                  <span
                    className="badge badge-error badge-xs font-bold text-white px-2 py-1.5 flex items-center gap-1 cursor-help"
                    title={validationErrors}
                  >
                    ✗ {t.schemaMismatch}
                  </span>
                ) : (
                  <span className="badge badge-success badge-xs font-bold text-white px-2 py-1.5 flex items-center gap-1">
                    ✓ {t.schemaMatch}
                  </span>
                ))}
            </div>
            <div className="flex-1 min-h-[120px] overflow-hidden">
              <TsCodeEditor
                value={editedMockData}
                onChange={setEditedMockData}
                language="json"
                customSuggestions={jsonCustomSuggestions}
                theme={theme}
                className="w-full h-full"
              />
            </div>
            {editedSchemaId && validationErrors && (
              <div className="mt-2 p-2 bg-error/5 border border-error/20 text-error rounded-xl font-mono text-[9px] max-h-[60px] overflow-y-auto whitespace-pre-wrap leading-tight shrink-0">
                {validationErrors}
              </div>
            )}
          </div>
        </div>

        {/* Live Preview Panel (Right Side - 4 columns) */}
        <div className="lg:col-span-4 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col h-full overflow-hidden">
          <h3 className="font-semibold text-xs text-base-content/70 mb-3 border-b border-base-200 pb-2 shrink-0">
            {t.livePreview}
          </h3>

          <div className="flex-1 bg-white border border-base-300 rounded-xl overflow-hidden relative">
            {compileError ? (
              <div className="absolute inset-0 p-4 bg-error/5 text-error font-mono text-[11px] overflow-auto flex flex-col space-y-2">
                <span className="font-bold flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> {t.compileError}
                </span>
                <pre className="whitespace-pre-wrap leading-relaxed">{compileError}</pre>
              </div>
            ) : iframeSrcDoc ? (
              <iframe
                title="Live Render Sandbox"
                srcDoc={iframeSrcDoc}
                sandbox="allow-scripts"
                className="w-full h-full border-none bg-transparent"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-base-content/40 italic">
                {t.waitingCompile}
              </div>
            )}
          </div>
        </div>
      </div>
      <SchemaEditorModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        schemaId={schemaModalTargetId}
        onSave={handleSchemaSaved}
      />
    </>
  );
}
