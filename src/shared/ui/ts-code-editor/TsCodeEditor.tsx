import * as Babel from "@babel/standalone";
import Editor, { type Monaco } from "@monaco-editor/react";
import clsx from "clsx";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readAppLang } from "@/shared/lib/i18n/app-lang";

export interface SuggestionItem {
  label: string;
  insertText?: string;
  detail?: string;
}

export type MonacoEditorInstance = Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0];

export interface TsCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  context?: Record<string, unknown>;
  customSuggestions?: SuggestionItem[];
  placeholder?: string;
  className?: string;
  rows?: number; // if rows === 1, it runs in single-line mode
  language?: "typescript" | "json" | "css" | "javascript" | "markdown";
  onEvaluate?: (result: unknown, error: string | null) => void;
  theme?: "horizon-gateway-light" | "horizon-gateway-dark" | string;
  onMount?: (editor: MonacoEditorInstance, monaco: Monaco) => void;
  editorRef?: React.MutableRefObject<MonacoEditorInstance | null>;
}

function getDocumentThemeColors(themeOverride?: string) {
  if (typeof document === "undefined") {
    return {
      isLight: false,
      base100: "#18181b",
      base200: "#27272a",
      content: "#d4d4d8",
      primary: "#9cdcfe",
      secondary: "#569cd6",
      accent: "#ce9178",
    };
  }

  const root = document.documentElement;
  const dataTheme = themeOverride || root.getAttribute("data-theme") || "";
  const isLight = dataTheme === "horizon-gateway-light" || dataTheme.toLowerCase().includes("light");

  const style = getComputedStyle(root);
  const getProp = (name: string, fallback: string) => {
    const val = style.getPropertyValue(name).trim();
    return val && (val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl")) ? val : fallback;
  };

  const base100 = getProp("--color-base-100", isLight ? "#ffffff" : "#18181b");
  const base200 = getProp("--color-base-200", isLight ? "#f8fafc" : "#27272a");
  const content = getProp("--color-base-content", isLight ? "#24292f" : "#d4d4d8");
  const primary = getProp("--color-primary", isLight ? "#0969da" : "#9cdcfe");
  const secondary = getProp("--color-secondary", isLight ? "#cf222e" : "#569cd6");
  const accent = getProp("--color-accent", isLight ? "#0a3069" : "#ce9178");

  return { isLight, base100, base200, content, primary, secondary, accent };
}

// Generate TS declarations (.d.ts) from runtime context object
function generateTypeDefinitions(context: Record<string, unknown>): string {
  let dts = "";

  function getTypeName(val: unknown, indent = "  "): string {
    if (val === null) {
      return "null";
    }
    if (val === undefined) {
      return "undefined";
    }
    if (Array.isArray(val)) {
      if (val.length > 0) {
        return `Array<${getTypeName(val[0], indent)}>`;
      }
      return "Array<unknown>";
    }
    if (typeof val === "object") {
      let res = "{\n";
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `"${k}"`;
        res += `${indent}${safeKey}: ${getTypeName(v, `${indent}  `)};\n`;
      }
      res += `${indent.slice(2)}}`;
      return res;
    }
    return typeof val;
  }

  for (const [key, value] of Object.entries(context)) {
    dts += `declare const ${key}: ${getTypeName(value)};\n`;
    if (key === "props") {
      dts += `declare type Props = typeof props;\n`;
      dts += `declare type PreviewProps = typeof props;\n`;
    }
  }

  return dts;
}

// Real-time TS Code Transpiler & Sandbox Evaluator
export function evaluateTsCode(code: string, context: Record<string, unknown> = {}): unknown {
  if (!code.trim()) {
    return null;
  }

  let cleanCode = code.trim();

  // If the code doesn't contain a return statement, wrap it to return the expression value
  if (!cleanCode.includes("return")) {
    if (cleanCode.includes("\n") || cleanCode.includes(";")) {
      const lines = cleanCode.split("\n");
      const lastLineIdx = lines.length - 1;
      const lastLine = lines[lastLineIdx].trim();
      if (
        lastLine &&
        !lastLine.startsWith("return") &&
        !lastLine.startsWith("const ") &&
        !lastLine.startsWith("let ") &&
        !lastLine.startsWith("var ")
      ) {
        lines[lastLineIdx] = `return (${lastLine});`;
      }
      cleanCode = lines.join("\n");
    } else {
      cleanCode = `return (${cleanCode});`;
    }
  }

  const wrappedCode = `
    function __evaluated_func() {
      ${cleanCode}
    }
    __evaluated_func();
  `;

  const compiled = Babel.transform(wrappedCode, {
    presets: [["react", { runtime: "classic" }], "typescript"],
    filename: "evaluate.tsx",
  }).code;

  if (!compiled) {
    throw new Error(readAppLang() === "ko" ? "컴파일 결과가 비어 있습니다." : "The compile result is empty.");
  }

  const keys = Object.keys(context);
  const values = Object.values(context);
  const fn = new Function(...keys, compiled);

  return fn(...values);
}

export const TsCodeEditor: React.FC<TsCodeEditorProps> = ({
  value,
  onChange,
  context = {},
  customSuggestions = [],
  className,
  rows = 4,
  language = "typescript",
  onEvaluate,
  theme,
  onMount,
  editorRef,
}) => {
  const [editorKey] = useState(() => Math.random().toString(36).substring(2, 9));
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const [_themeVersion, setThemeVersion] = useState(0);
  const extraLibRef = useRef<{ dispose: () => void } | null>(null);
  const customSuggestRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => {
      setThemeVersion((v) => v + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });
    return () => observer.disconnect();
  }, []);

  const themeColors = getDocumentThemeColors(theme);
  const { isLight, base100, base200, content, primary, secondary, accent } = themeColors;

  const applyThemeToMonaco = useCallback(
    (monaco: Monaco) => {
      const dynamicThemeName = isLight ? "horizon-gateway-light" : "horizon-gateway-dark";

      monaco.editor.defineTheme(dynamicThemeName, {
        base: isLight ? "vs" : "vs-dark",
        inherit: true,
        rules: isLight
          ? [
              { token: "identifier", foreground: primary.replace("#", "") },
              { token: "identifier.js", foreground: primary.replace("#", "") },
              { token: "identifier.ts", foreground: primary.replace("#", "") },
              { token: "keyword", foreground: secondary.replace("#", "") },
              { token: "string", foreground: accent.replace("#", "") },
              { token: "number", foreground: "0550ae" },
              { token: "comment", foreground: "6e7781" },
              { token: "delimiter", foreground: content.replace("#", "") },
              { token: "type", foreground: "953800" },
            ]
          : [
              { token: "identifier", foreground: primary.replace("#", "") },
              { token: "identifier.js", foreground: primary.replace("#", "") },
              { token: "identifier.ts", foreground: primary.replace("#", "") },
              { token: "keyword", foreground: secondary.replace("#", "") },
              { token: "string", foreground: accent.replace("#", "") },
              { token: "number", foreground: "b5cea8" },
              { token: "comment", foreground: "6a9955" },
              { token: "delimiter", foreground: content.replace("#", "") },
              { token: "type", foreground: "4ec9b0" },
            ],
        colors: {
          "editor.background": base100,
          "editor.foreground": content,
          "editorLineNumber.foreground": isLight ? "#8c959f" : "#52525b",
          "editorLineNumber.activeForeground": content,
          "editor.lineHighlightBackground": base200,
          "editor.selectionBackground": isLight ? "#add6ff80" : "#264f7880",

          // Suggest / Autocomplete Widget
          "editorSuggestWidget.background": base100,
          "editorSuggestWidget.border": isLight ? "#e2e8f0" : "#334155",
          "editorSuggestWidget.foreground": content,
          "editorSuggestWidget.highlightForeground": primary,
          "editorSuggestWidget.selectedBackground": isLight ? "#e2e8f0" : "#334155",
          "editorSuggestWidget.selectedForeground": content,
          "editorSuggestWidget.focusHighlightForeground": primary,

          // Hover Widget & General Widgets
          "editorHoverWidget.background": base100,
          "editorHoverWidget.border": isLight ? "#e2e8f0" : "#334155",
          "editorHoverWidget.foreground": content,
          "editorWidget.background": base100,
          "editorWidget.border": isLight ? "#e2e8f0" : "#334155",
          "editorWidget.foreground": content,

          // List states inside Suggest / Pickers
          "list.hoverBackground": isLight ? "#f1f5f9" : "#1e293b",
          "list.activeSelectionBackground": isLight ? "#e2e8f0" : "#334155",
          "list.activeSelectionForeground": content,
          "list.focusBackground": isLight ? "#e2e8f0" : "#334155",
          "list.focusForeground": content,
          "list.highlightForeground": primary,
          "list.inactiveSelectionBackground": isLight ? "#f1f5f9" : "#1e293b",
          "list.inactiveSelectionForeground": content,
        },
      });

      monaco.editor.setTheme(dynamicThemeName);
    },
    [isLight, base100, base200, content, primary, secondary, accent],
  );

  useEffect(() => {
    if (monacoInstance) {
      applyThemeToMonaco(monacoInstance);
    }
  }, [monacoInstance, applyThemeToMonaco]);

  // Debounced evaluation
  useEffect(() => {
    if (!onEvaluate) {
      return;
    }
    const timer = setTimeout(() => {
      try {
        const res = evaluateTsCode(value, context);
        onEvaluate(res, null);
      } catch (err) {
        const error = err as Error;
        onEvaluate(null, error.message || String(err));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [value, context, onEvaluate]);

  // Inject types and suggestions into Monaco instance
  useEffect(() => {
    if (!monacoInstance) {
      return;
    }

    // 1. Inject dynamic typings (d.ts) for TypeScript autocomplete
    if (extraLibRef.current) {
      extraLibRef.current.dispose();
      extraLibRef.current = null;
    }

    const dts = generateTypeDefinitions(context);
    if (dts) {
      extraLibRef.current = monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
        dts,
        `ts:filename/horizon-gateway-context-${editorKey}.d.ts`,
      );
    }

    // 2. Inject custom suggestions (e.g. Schema fields, Markdown links or keyword shortcuts)
    if (customSuggestRef.current) {
      customSuggestRef.current.dispose();
      customSuggestRef.current = null;
    }

    if (customSuggestions.length > 0) {
      customSuggestRef.current = monacoInstance.languages.registerCompletionItemProvider(language, {
        triggerCharacters: language === "markdown" ? ["[", "/", "#", "@", ":"] : undefined,
        provideCompletionItems: (
          model: Parameters<
            Parameters<Monaco["languages"]["registerCompletionItemProvider"]>[1]["provideCompletionItems"]
          >[0],
          position: Parameters<
            Parameters<Monaco["languages"]["registerCompletionItemProvider"]>[1]["provideCompletionItems"]
          >[1],
        ) => {
          const expectedUri =
            language === "typescript"
              ? `file:///preview_${editorKey}.tsx`
              : language === "javascript"
                ? `file:///preview_${editorKey}.jsx`
                : language === "json"
                  ? `file:///mock_${editorKey}.json`
                  : language === "markdown"
                    ? `file:///guide_${editorKey}.md`
                    : "";

          if (expectedUri && model.uri.toString() !== expectedUri) {
            return { suggestions: [] };
          }

          if (language === "markdown") {
            const lineContent = model.getLineContent(position.lineNumber);
            const lineUntilCursor = lineContent.slice(0, position.column - 1);
            const lineAfterCursor = lineContent.slice(position.column - 1);

            const wikiMatch = /\[\[([^\]]*)$/.exec(lineUntilCursor);
            if (wikiMatch) {
              const startColumn = position.column - wikiMatch[0].length;
              let endColumn = position.column;
              if (lineAfterCursor.startsWith("]]")) {
                endColumn += 2;
              } else if (lineAfterCursor.startsWith("]")) {
                endColumn += 1;
              }

              const wikiRange = {
                startLineNumber: position.lineNumber,
                startColumn,
                endLineNumber: position.lineNumber,
                endColumn,
              };

              // Filter suggestions for wiki links (exclude heading templates)
              const wikiItems = customSuggestions.filter(
                (item) => item.insertText?.includes("hg://") || !item.label.startsWith("#"),
              );

              return {
                suggestions: wikiItems.map((item) => ({
                  label: item.label,
                  kind: monacoInstance.languages.CompletionItemKind.Reference,
                  documentation: item.detail,
                  insertText: item.insertText || item.label,
                  range: wikiRange,
                  filterText: `[[${item.label}`,
                })),
              };
            }

            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: word.endColumn,
            };

            return {
              suggestions: customSuggestions.map((item) => ({
                label: item.label,
                kind: item.insertText?.includes("hg://")
                  ? monacoInstance.languages.CompletionItemKind.Reference
                  : monacoInstance.languages.CompletionItemKind.Snippet,
                documentation: item.detail,
                insertText: item.insertText || item.label,
                range,
              })),
            };
          }

          // Verify we are at the root level or typing a key, not inside a dot path
          const textUntilPosition = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          // If typing after a dot, let Monaco's TS service handle member autocompletion
          if (textUntilPosition.endsWith(".")) {
            return { suggestions: [] };
          }

          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: customSuggestions.map((item) => ({
              label: item.label,
              kind: monacoInstance.languages.CompletionItemKind.Field,
              documentation: item.detail,
              insertText: item.insertText || item.label,
              range,
            })),
          };
        },
      });
    }

    return () => {
      if (extraLibRef.current) {
        extraLibRef.current.dispose();
      }
      if (customSuggestRef.current) {
        customSuggestRef.current.dispose();
      }
    };
  }, [context, customSuggestions, monacoInstance, language, editorKey]);

  const handleEditorWillMount = (monaco: Monaco) => {
    setMonacoInstance(monaco);
    applyThemeToMonaco(monaco);

    // Setup TypeScript compiler configurations for JSX/TSX support
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: 1, // JsxEmit.React = 1
      target: 99, // ScriptTarget.Latest = 99
      allowNonTsExtensions: true,
      moduleResolution: 2, // ModuleResolutionKind.NodeJs = 2
    });

    // Disable syntax and semantic diagnostics to prevent false-positive red underlines in template expressions
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  };

  const isSingleLine = rows === 1;

  const handleEditorDidMount = (editor: MonacoEditorInstance, monaco: Monaco) => {
    if (editorRef) {
      editorRef.current = editor;
    }
    if (onMount) {
      onMount(editor, monaco);
    }
    if (isSingleLine) {
      // Force layout calculation on content change to ensure wordWrap updates e.contentHeight
      editor.onDidChangeModelContent(() => {
        editor.layout();
      });

      editor.onDidContentSizeChange((e: { contentHeight: number }) => {
        const contentHeight = e.contentHeight;
        // Restrict auto-grow height between 30px (1 line) and 120px (approx 5 lines)
        const newHeight = Math.max(30, Math.min(contentHeight, 120));
        const container = editor.getContainerDomNode();
        if (container?.parentElement) {
          container.parentElement.style.height = `${newHeight}px`;
        }
      });
    }
  };

  // Monaco Editor Options configuration
  const editorOptions = {
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 11,
    fontFamily: "Fira Code, monospace, JetBrains Mono, Courier New",
    lineHeight: 18,
    renderLineHighlight: isSingleLine ? ("none" as const) : ("all" as const),
    scrollbar: isSingleLine
      ? { vertical: "hidden" as const, horizontal: "hidden" as const, handleMouseWheel: false }
      : { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    // Single-line inputs configuration adjustments
    lineNumbers: isSingleLine ? ("off" as const) : ("on" as const),
    glyphMargin: !isSingleLine,
    folding: !isSingleLine,
    lineDecorationsWidth: isSingleLine ? 0 : 10,
    lineNumbersMinChars: isSingleLine ? 0 : 3,
    wordWrap: "on" as const,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    padding: isSingleLine ? { top: 5, bottom: 5 } : { top: 8, bottom: 8 },
    // Prevent clipping of autocomplete popover by overflow parent containers
    fixedOverflowWidgets: true,
  };

  return (
    <div
      className={clsx(
        "border border-base-300 rounded-xl overflow-hidden bg-base-100 focus-within:border-primary/50 transition-all duration-150 w-full",
        isSingleLine ? "h-[30px]" : "h-full min-h-[120px]",
        className,
      )}
    >
      <Editor
        language={language}
        path={
          language === "typescript"
            ? `file:///preview_${editorKey}.tsx`
            : language === "javascript"
              ? `file:///preview_${editorKey}.jsx`
              : language === "json"
                ? `file:///mock_${editorKey}.json`
                : language === "markdown"
                  ? `file:///guide_${editorKey}.md`
                  : undefined
        }
        theme={isLight ? "horizon-gateway-light" : "horizon-gateway-dark"}
        value={value}
        onChange={(val) => onChange(val || "")}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        options={editorOptions}
        className="w-full h-full"
      />
    </div>
  );
};
