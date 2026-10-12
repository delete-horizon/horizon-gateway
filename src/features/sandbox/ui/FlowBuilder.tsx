import {
  addEdge,
  Background,
  type Connection,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { getDefaultStore, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import * as Babel from "@babel/standalone";
import CryptoJS from "crypto-js";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  FileCode,
  Globe,
  HelpCircle,
  Lock,
  Play,
  Plus,
  Settings,
  Shuffle,
  Trash2,
  Tv,
} from "lucide-react";
import { languageAtom, themeAtom } from "@/entities/app";
import {
  flowToReactFlow,
  type PipelineExecutionReport,
  reactFlowToFlow,
  sandboxActiveFlowAtom,
} from "@/entities/pipeline";
import {
  apiClientCurrentRequestAtom,
  apiClientHistoryAtom,
  type CryptoAction,
  CryptoNode,
  executePipelineApiNode,
  type NodeExecutionResult,
  processCrypto,
  savedComponentsAtom,
  savedCryptoPresetsAtom,
  savedJsonSchemasAtom,
  validateJsonSchema,
} from "@/entities/sandbox";
import { TsCodeEditor } from "@/shared/ui/ts-code-editor/TsCodeEditor";
import { en as flowEn } from "../i18n/flow-en";
import { ko as flowKo } from "../i18n/flow-ko";
import { LivePreviewer } from "./LivePreviewer";
import { SchemaEditorModal } from "./SchemaEditorModal";

function useFlowCopy() {
  const lang = useAtomValue(languageAtom);
  return lang === "ko" ? flowKo : flowEn;
}

if (typeof window !== "undefined") {
  (window as unknown as { CryptoJS: unknown }).CryptoJS = CryptoJS;
}

export interface FlowNodeData {
  label?: string;
  config?: Record<string, unknown>;
  isRunning?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
  elapsedMs?: number | null;
}

// ── Custom Node Components ──────────────────────────────────────────────────

// 1. API Node Component
function ApiNodeComponent({ data }: { data: FlowNodeData }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;
  const elapsedMs = data.elapsedMs;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md min-w-[180px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <Globe className="w-4 h-4 text-success" />
        <span className="text-xs font-bold text-base-content/80">{t.apiRequest}</span>
      </div>
      <div className="space-y-1">
        <div className="text-[11px] font-bold font-mono">
          <span className="text-success mr-1">{(data.config?.method as string) || "GET"}</span>
          <span className="text-base-content/50 truncate max-w-[100px] inline-block align-bottom">
            {data.config?.url
              ? (() => {
                  try {
                    return new URL(String(data.config.url)).pathname;
                  } catch {
                    return String(data.config.url);
                  }
                })()
              : "/endpoint"}
          </span>
        </div>
        {elapsedMs && <div className="text-[9px] text-base-content/40">{elapsedMs}ms</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary" />
    </div>
  );
}

// 2. Crypto Node Component
function CryptoNodeComponent({ data }: { data: FlowNodeData }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md min-w-[180px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <Lock className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-base-content/80">{t.cryptoTool}</span>
      </div>
      <div className="text-[10px] font-mono font-bold text-primary/80 uppercase">
        {(data.config?.action as string) || "base64Encode"}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary" />
    </div>
  );
}

// 3. Schema Validation Node Component
function SchemaNodeComponent({ data }: { data: FlowNodeData }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md min-w-[180px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <FileCode className="w-4 h-4 text-warning" />
        <span className="text-xs font-bold text-base-content/80">{t.schemaValid}</span>
      </div>
      <div className="text-[10px] font-semibold text-base-content/60">{t.payloadVsSchema}</div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary" />
    </div>
  );
}

// 4. Preview Node Component
function PreviewNodeComponent({ data }: { data: FlowNodeData & { previewData?: unknown } }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;
  const config = data.config || {};
  const code = (config.code as string) || "";
  const previewData = data.previewData;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md w-[320px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <Tv className="w-4 h-4 text-secondary" />
        <span className="text-xs font-bold text-base-content/80">{t.uiPreview}</span>
      </div>
      {isSuccess && code ? (
        <div className="w-full h-[200px] border border-base-200 rounded-lg overflow-hidden bg-white mt-1.5 relative">
          <LivePreviewer code={code} initialData={previewData} />
        </div>
      ) : (
        <div className="text-[10px] font-semibold text-base-content/60 py-8 text-center italic bg-base-200/30 rounded-lg border border-dashed border-base-300 mt-1.5">
          {isRunning ? t.running : t.previewIdle}
        </div>
      )}
    </div>
  );
}

// 5. Mapper Node Component
function MapperNodeComponent({ data }: { data: FlowNodeData }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md min-w-[180px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <Shuffle className="w-4 h-4 text-info" />
        <span className="text-xs font-bold text-base-content/80">{t.dataMapper}</span>
      </div>
      <div className="text-[10px] font-semibold text-base-content/60">
        {t.mappingsDefined((data.config?.mappings as unknown[])?.length || 0)}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary" />
    </div>
  );
}

// 6. Custom Script Node Component
function ScriptNodeComponent({ data }: { data: FlowNodeData }) {
  const t = useFlowCopy();
  const isRunning = data.isRunning;
  const isSuccess = data.isSuccess;
  const isError = data.isError;
  const elapsedMs = data.elapsedMs;

  return (
    <div
      className={`p-3 rounded-xl border bg-base-100 shadow-md min-w-[180px] transition-all ${
        isRunning
          ? "border-primary ring-2 ring-primary/20 animate-pulse"
          : isSuccess
            ? "border-success ring-1 ring-success/30"
            : isError
              ? "border-error ring-1 ring-error/30"
              : "border-base-300 hover:border-primary/40"
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-primary" />
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-base-200">
        <FileCode className="w-4 h-4 text-accent" />
        <span className="text-xs font-bold text-base-content/80">{t.jsScriptNode}</span>
      </div>
      <div className="text-[10px] font-semibold text-base-content/60">
        {isRunning ? (
          t.running
        ) : elapsedMs !== null && elapsedMs !== undefined ? (
          <span className="text-success font-bold">{t.doneMs(elapsedMs)}</span>
        ) : (
          t.waiting
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-primary" />
    </div>
  );
}

// Node registrations object for React Flow
const nodeTypes = {
  api: ApiNodeComponent,
  crypto: CryptoNodeComponent,
  schema: SchemaNodeComponent,
  preview: PreviewNodeComponent,
  mapper: MapperNodeComponent,
  script: ScriptNodeComponent,
};

const resolveInterpolatedValue = (val: unknown, results: NodeExecutionResult[]): unknown => {
  // Construct evaluation context from previous nodes' outputs
  const context: Record<string, unknown> = {};
  results.forEach((res) => {
    try {
      context[res.nodeId] = JSON.parse(res.output);
    } catch {
      context[res.nodeId] = res.output;
    }
  });

  const keys = Object.keys(context);
  const values = Object.values(context);

  const evalExpr = (expr: string) => {
    try {
      const fn = new Function(...keys, `return (${expr.trim()});`);
      return fn(...values);
    } catch (e) {
      console.error("Expression evaluation error:", expr, e);
      return `{{${expr}}}`;
    }
  };

  if (typeof val === "string") {
    const trimmed = val.trim();
    // Check if the entire string is a single expression like `{{api_1.body}}`
    // If so, preserve original resolved type (Object, Array, Boolean, etc.)
    const fullMatch = trimmed.match(/^\{\{([^}]+)\}\}$/);
    if (fullMatch) {
      return evalExpr(fullMatch[1]);
    }

    // Inline expression string templating, e.g. `Bearer {{auth.token}}`
    return val.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      const res = evalExpr(expr);
      if (res === null || res === undefined) {
        return "";
      }
      return typeof res === "object" ? JSON.stringify(res) : String(res);
    });
  } else if (Array.isArray(val)) {
    return val.map((item) => resolveInterpolatedValue(item, results));
  } else if (val !== null && typeof val === "object") {
    const res: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>)) {
      res[key] = resolveInterpolatedValue((val as Record<string, unknown>)[key], results);
    }
    return res;
  }
  return val;
};

// ── Main FlowBuilder Component ──────────────────────────────────────────────

export interface FlowBuilderProps {
  onExportPreviewData?: (data: unknown) => void;
}

export function FlowBuilder({ onExportPreviewData }: FlowBuilderProps) {
  const [activeFlow, setActiveFlow] = useAtom(sandboxActiveFlowAtom);
  const persistedFlow = activeFlow.flow;

  const apiClientCurrentRequest = useAtomValue(apiClientCurrentRequestAtom);
  const apiClientHistory = useAtomValue(apiClientHistoryAtom);
  const savedJsonSchemas = useAtomValue(savedJsonSchemasAtom);
  const savedCryptoPresets = useAtomValue(savedCryptoPresetsAtom);
  const savedComponents = useAtomValue(savedComponentsAtom);
  const theme = useAtomValue(themeAtom);
  const t = useFlowCopy();

  // Map persisted data into React Flow state
  const initialNodes = useMemo(() => flowToReactFlow(persistedFlow).nodes, [persistedFlow]);
  const initialEdges = useMemo(() => flowToReactFlow(persistedFlow).edges, [persistedFlow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Active configurations panel states
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [report, setReport] = useState<PipelineExecutionReport | null>(null);
  const [resultTab, setResultTab] = useState<"input" | "output">("output");
  const applyingExternalFlow = useRef(true);
  const flowRef = useRef(activeFlow.flow);
  flowRef.current = activeFlow.flow;

  // Reload canvas only when a saved pipeline is loaded or a new blank flow is created.
  // Persist writes a new `flow` object every time — that must not reset the canvas.
  useEffect(() => {
    applyingExternalFlow.current = true;
    const { nodes: nextNodes, edges: nextEdges } = flowToReactFlow(flowRef.current);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    setReport(null);
  }, [activeFlow.revision, setNodes, setEdges]);

  // JSON Schema Editor Modal State
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [schemaModalTargetId, setSchemaModalTargetId] = useState<string | undefined>(undefined);
  const [schemaModalCallback, setSchemaModalCallback] = useState<((savedId: string) => void) | undefined>(undefined);

  const openSchemaEditor = (isNew: boolean, currentId?: string, onSaveCallback?: (savedId: string) => void) => {
    setSchemaModalTargetId(isNew ? undefined : currentId);
    setSchemaModalCallback(() => onSaveCallback);
    setIsSchemaModalOpen(true);
  };

  // Save changes back to Jotai
  const saveFlowToStorage = useCallback(
    (
      updatedNodes: Array<{
        id: string;
        type?: string;
        position: { x: number; y: number };
        data: { label?: string; config?: unknown };
      }>,
      updatedEdges: Array<{ id: string; source: string; target: string }>,
    ) => {
      setActiveFlow((prev) => ({
        ...prev,
        flow: reactFlowToFlow(updatedNodes, updatedEdges),
        updatedAt: Date.now(),
      }));
    },
    [setActiveFlow],
  );

  // Save changes to Jotai whenever the user edits the canvas (not when we apply an external load).
  useEffect(() => {
    if (applyingExternalFlow.current) {
      applyingExternalFlow.current = false;
      return;
    }
    saveFlowToStorage(nodes, edges);
  }, [nodes, edges, saveFlowToStorage]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
    },
    [onEdgesChange],
  );

  // Node Insertion
  const addNode = (type: "api" | "crypto" | "schema" | "preview" | "mapper" | "script") => {
    const id = `${type}_${Math.random().toString(36).substring(2, 9)}`;
    const label =
      type === "api"
        ? "API Request"
        : type === "crypto"
          ? "Crypto Node"
          : type === "schema"
            ? "Schema Node"
            : type === "mapper"
              ? "Mapper Node"
              : type === "script"
                ? "Custom Script"
                : "UI Preview Node";

    let config: Record<string, unknown> = {};
    if (type === "api") {
      config = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/1",
        headers: {},
        body: "",
        errorPolicy: "fastFail",
      };
    } else if (type === "crypto") {
      config = {
        action: "base64Encode",
        payload: "{{api_node_id.body.some_field}}",
        key: "",
        iv: "",
        errorPolicy: "fastFail",
      };
    } else if (type === "schema") {
      config = { payload: "{{api_node_id.body}}", schema: "{}", errorPolicy: "fastFail" };
    } else if (type === "mapper") {
      config = {
        mappings: [{ targetKey: "title", sourceValue: "" }],
        errorPolicy: "fastFail",
      };
    } else if (type === "script") {
      config = {
        code: `export default async function(inputs) {
  // inputs 에는 이전 노드들의 실행 결과가 노드 ID를 키로 하여 들어있습니다.
  // 예: const apiBody = inputs.api_1?.body;
  
  // CryptoJS 라이브러리가 전역에 제공되므로 바로 사용할 수 있습니다.
  // 예: const hash = CryptoJS.SHA256("test").toString();
  
  return "Hello, Horizon Gateway!";
}`,
        errorPolicy: "fastFail",
      };
    } else {
      config = {
        code: `export default function Preview(props) {
  const hasProps = props && Object.keys(props).length > 0;
  const display = hasProps ? props : { text: "No input data" };
  return (
    <div className="p-4 bg-secondary/10 border border-secondary/20 rounded-xl">
      <h3 className="font-bold text-secondary">React Live Preview</h3>
      <pre className="text-xs mt-2 font-mono">{JSON.stringify(display, null, 2)}</pre>
    </div>
  );
}`,
        errorPolicy: "continueOnError",
      };
    }

    const newNode = {
      id,
      type,
      position: { x: Math.random() * 200 + 100, y: Math.random() * 150 + 100 },
      data: {
        label,
        config,
        isRunning: false,
        isSuccess: false,
        isError: false,
        elapsedMs: null,
      },
    };

    const updatedNodes = [...nodes, newNode];
    setNodes(updatedNodes);
    setSelectedNodeId(id);
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) {
      return;
    }
    const updatedNodes = nodes.filter((n) => n.id !== selectedNodeId);
    const updatedEdges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelectedNodeId(null);
  };

  // Config Mutators
  const updateNodeConfig = (nodeId: string, updatedConfig: Record<string, unknown>) => {
    const updated = nodes.map((n) => {
      if (n.id === nodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            config: updatedConfig,
          },
        };
      }
      return n;
    });
    setNodes(updated);
  };

  // Run Visual Flow
  const handleExecute = async () => {
    setExecuting(true);
    setReport(null);

    // Reset visual nodes states
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, isRunning: false, isSuccess: false, isError: false, elapsedMs: null },
      })),
    );

    const startTime = Date.now();
    const results: NodeExecutionResult[] = [];

    // Helper: Sort DAG topologically
    const sortDag = (
      flowNodes: Array<{ id: string }>,
      flowEdges: Array<{ source: string; target: string }>,
    ): string[] => {
      const inDegree: Record<string, number> = {};
      const adj: Record<string, string[]> = {};

      flowNodes.forEach((n) => {
        inDegree[n.id] = 0;
        adj[n.id] = [];
      });

      flowEdges.forEach((e) => {
        if (adj[e.source]) {
          adj[e.source].push(e.target);
          inDegree[e.target] = (inDegree[e.target] || 0) + 1;
        }
      });

      const queue: string[] = [];
      flowNodes.forEach((n) => {
        if (inDegree[n.id] === 0) {
          queue.push(n.id);
        }
      });

      const order: string[] = [];
      while (queue.length > 0) {
        const u = queue.shift()!;
        order.push(u);

        (adj[u] || []).forEach((v) => {
          inDegree[v]--;
          if (inDegree[v] === 0) {
            queue.push(v);
          }
        });
      }

      if (order.length !== flowNodes.length) {
        throw new Error(t.cycle);
      }

      return order;
    };

    let order: string[] = [];
    try {
      order = sortDag(nodes, edges);
    } catch (e) {
      const err = e as Error;
      setReport({
        success: false,
        elapsedMs: Date.now() - startTime,
        results: [],
        error: err.message || String(e),
      });
      setExecuting(false);
      return;
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    let pipelineSuccess = true;
    let pipelineError: string | null = null;

    try {
      for (const nodeId of order) {
        const node = nodeMap.get(nodeId);
        if (!node) {
          continue;
        }

        // Visual feedback: Mark current node as running
        setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isRunning: true } } : n)));

        const nodeStart = Date.now();
        let interpolatedConfig: Record<string, unknown> | null = null;

        try {
          interpolatedConfig = (resolveInterpolatedValue(node.data.config, results) as Record<string, unknown>) || {};
        } catch (e) {
          const err = e as Error;
          const elapsed = Date.now() - nodeStart;
          const errorMsg = t.interpolateError(err.message || String(e));
          results.push({
            nodeId,
            success: false,
            elapsedMs: elapsed,
            output: "null",
            error: errorMsg,
          });

          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, isRunning: false, isSuccess: false, isError: true, elapsedMs: elapsed } }
                : n,
            ),
          );
          pipelineSuccess = false;
          pipelineError = t.abortedAt(String(node.data.label ?? node.id), errorMsg);
          break;
        }

        let output: unknown = null;
        let nodeSuccess = false;
        let nodeError: string | null = null;

        try {
          if (node.type === "api") {
            output = await executePipelineApiNode(interpolatedConfig);
            nodeSuccess = true;
          } else if (node.type === "crypto") {
            const action = (interpolatedConfig.action as string) || "base64Encode";
            const payload = (interpolatedConfig.payload as string) || "";
            const key = (interpolatedConfig.key as string) || "";
            const iv = (interpolatedConfig.iv as string) || "";

            if (action === "custom") {
              const code = (interpolatedConfig.code as string) || "";
              let transpiled = "";
              try {
                transpiled =
                  Babel.transform(code, {
                    presets: ["typescript"],
                    plugins: ["transform-modules-commonjs"],
                    filename: "crypto_custom.ts",
                  }).code || "";
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(t.compileError(message));
              }

              const runFn = new Function("exports", transpiled);
              const exportsObj: Record<string, unknown> = {};
              runFn(exportsObj);

              const defaultExport = exportsObj.default;
              if (typeof defaultExport !== "function") {
                throw new Error(t.cryptoExport);
              }

              const customResult = await defaultExport(payload, key, iv);
              output = {
                result: typeof customResult === "string" ? customResult : JSON.stringify(customResult, null, 2),
              };
              nodeSuccess = true;
            } else {
              const res = await processCrypto(action as CryptoAction, payload, key || undefined, iv || undefined);
              output = { result: res };
              nodeSuccess = true;
            }
          } else if (node.type === "schema") {
            const payload = (interpolatedConfig.payload as string) || "";
            const schema = (interpolatedConfig.schema as string) || "";
            const res = await validateJsonSchema(payload, schema);
            output = { valid: res.valid, errors: res.errors };
            nodeSuccess = true;
          } else if (node.type === "preview") {
            const incomingEdge = edges.find((e) => e.target === node.id);
            let parentData: unknown = null;
            if (incomingEdge) {
              const parentResult = results.find((r) => r.nodeId === incomingEdge.source);
              if (parentResult?.success) {
                try {
                  parentData = JSON.parse(parentResult.output);
                  if (
                    parentData &&
                    typeof parentData === "object" &&
                    "result" in (parentData as Record<string, unknown>)
                  ) {
                    parentData = (parentData as Record<string, unknown>).result;
                  }
                } catch {
                  parentData = parentResult.output;
                }
              }
            }
            output = parentData;
            nodeSuccess = true;
          } else if (node.type === "mapper") {
            const mappedObj: Record<string, unknown> = {};
            if (Array.isArray(interpolatedConfig.mappings)) {
              (interpolatedConfig.mappings as Array<{ targetKey: string; sourceValue: string }>).forEach((m) => {
                if (m.targetKey && m.targetKey.trim() !== "") {
                  mappedObj[m.targetKey.trim()] = m.sourceValue;
                }
              });
            }
            output = mappedObj;
            nodeSuccess = true;
          } else if (node.type === "script") {
            const code = (interpolatedConfig.code as string) || "";
            let transpiled = "";
            try {
              transpiled =
                Babel.transform(code, {
                  presets: ["typescript"],
                  plugins: ["transform-modules-commonjs"],
                  filename: "script.ts",
                }).code || "";
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              throw new Error(t.compileError(message));
            }

            // Create inputs object containing outputs of all previous nodes
            const inputs: Record<string, unknown> = {};
            results.forEach((res) => {
              try {
                inputs[res.nodeId] = JSON.parse(res.output);
              } catch {
                inputs[res.nodeId] = res.output;
              }
            });

            // Execute the code
            const runFn = new Function("exports", "inputs", transpiled);
            const exportsObj: Record<string, unknown> = {};
            runFn(exportsObj, inputs);

            const defaultExport = exportsObj.default;
            if (typeof defaultExport !== "function") {
              throw new Error(t.scriptExport);
            }

            const scriptResult = await defaultExport(inputs);
            if (typeof scriptResult === "object" && scriptResult !== null) {
              output = scriptResult;
            } else {
              output = { result: scriptResult };
            }
            nodeSuccess = true;
          } else {
            throw new Error(t.unsupportedNode(String(node.type)));
          }
        } catch (e) {
          const err = e as Error;
          nodeSuccess = false;
          nodeError = err.message || String(e);
        }

        const elapsed = Date.now() - nodeStart;

        // Update node visual state
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    isRunning: false,
                    isSuccess: nodeSuccess,
                    isError: !nodeSuccess,
                    elapsedMs: elapsed,
                    ...(node.type === "preview" ? { previewData: output } : {}),
                  },
                }
              : n,
          ),
        );

        if (!nodeSuccess) {
          results.push({
            nodeId,
            success: false,
            elapsedMs: elapsed,
            output: "null",
            error: nodeError,
          });

          const errorPolicy = interpolatedConfig?.errorPolicy || "fastFail";
          if (errorPolicy !== "continueOnError") {
            pipelineSuccess = false;
            pipelineError = t.abortedAt(String(node.data.label ?? node.id), nodeError ?? "");
            break;
          }
        } else {
          results.push({
            nodeId,
            success: true,
            elapsedMs: elapsed,
            output: JSON.stringify(output),
            error: null,
          });
        }
      }
    } catch (e) {
      const err = e as Error;
      pipelineSuccess = false;
      pipelineError = err.message || String(e);
    }

    setReport({
      success: pipelineSuccess,
      elapsedMs: Date.now() - startTime,
      results,
      error: pipelineError,
    });
    setExecuting(false);
  };

  // Find active selected node object
  const activeNode = nodes.find((n) => n.id === selectedNodeId);

  const autoImportKeys = useCallback(() => {
    if (!report || !selectedNodeId) {
      return;
    }
    const mapperNode = nodes.find((n) => n.id === selectedNodeId);
    if (!mapperNode || mapperNode.type !== "mapper") {
      return;
    }

    const runResults = report.results.filter((r) => r.nodeId !== selectedNodeId && r.success);
    if (runResults.length === 0) {
      return;
    }

    const lastResult = runResults[runResults.length - 1];
    const precedingNode = nodes.find((n) => n.id === lastResult.nodeId);
    if (!precedingNode) {
      return;
    }

    try {
      const outputObj = JSON.parse(lastResult.output);
      let targetObj = outputObj;
      let pathPrefix = "";

      if (precedingNode.type === "api" && outputObj && typeof outputObj.body === "object" && outputObj.body !== null) {
        targetObj = outputObj.body;
        pathPrefix = "body.";
      } else if (
        precedingNode.type === "crypto" &&
        outputObj &&
        typeof outputObj.result === "object" &&
        outputObj.result !== null
      ) {
        targetObj = outputObj.result;
        pathPrefix = "result.";
      }

      if (targetObj && typeof targetObj === "object" && !Array.isArray(targetObj)) {
        const newMappings = Object.keys(targetObj).map((key) => ({
          targetKey: key,
          sourceValue: `{{${precedingNode.id}.${pathPrefix}${key}}}`,
        }));

        updateNodeConfig(mapperNode.id, {
          ...mapperNode.data.config,
          mappings: [
            ...(((mapperNode.data.config?.mappings as unknown[]) || []) as Array<{
              targetKey: string;
              sourceValue: string;
            }>),
            ...newMappings,
          ],
        });
      }
    } catch (e) {
      console.error("Auto import keys failed", e);
    }
  }, [report, selectedNodeId, nodes, updateNodeConfig]);

  // List of variables candidates from preceding nodes (for template mapping helper)
  const variableCandidates = useMemo(() => {
    return nodes
      .filter((n) => n.id !== selectedNodeId)
      .map((n) => {
        if (n.type === "api") {
          return { id: n.id, label: `${n.data.label} (${n.id})`, paths: ["body", "statusCode", "headers"] };
        } else if (n.type === "crypto") {
          return { id: n.id, label: `${n.data.label} (${n.id})`, paths: ["result"] };
        } else if (n.type === "script") {
          return { id: n.id, label: `${n.data.label} (${n.id})`, paths: ["result"] };
        } else {
          return { id: n.id, label: `${n.data.label} (${n.id})`, paths: ["valid", "errors"] };
        }
      });
  }, [nodes, selectedNodeId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full h-full items-stretch">
      {/* Visual Canvas (Left Side - 8 columns) */}
      <div className="lg:col-span-8 card bg-base-100 border border-base-300 p-0 shadow-sm overflow-hidden flex flex-col h-full relative">
        {/* Canvas Toolbar */}
        <div className="flex items-center justify-between p-3 bg-base-200 border-b border-base-300 shrink-0 z-10">
          <div className="flex gap-2">
            <button className="btn btn-xs btn-outline btn-ghost flex items-center gap-1" onClick={() => addNode("api")}>
              <Plus className="w-3.5 h-3.5 text-success" /> {t.addApi}
            </button>
            <button
              className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
              onClick={() => addNode("crypto")}
            >
              <Plus className="w-3.5 h-3.5 text-primary" /> {t.addCrypto}
            </button>
            <button
              className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
              onClick={() => addNode("schema")}
            >
              <Plus className="w-3.5 h-3.5 text-warning" /> {t.addSchema}
            </button>
            <button
              className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
              onClick={() => addNode("mapper")}
            >
              <Plus className="w-3.5 h-3.5 text-info" /> {t.addMapper}
            </button>
            <button
              className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
              onClick={() => addNode("preview")}
            >
              <Plus className="w-3.5 h-3.5 text-secondary" /> {t.addPreview}
            </button>
            <button
              className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
              onClick={() => addNode("script")}
            >
              <Plus className="w-3.5 h-3.5 text-accent" /> {t.addScript}
            </button>
          </div>

          <div className="flex gap-2">
            {selectedNodeId && (
              <button className="btn btn-xs btn-error btn-outline flex items-center gap-1" onClick={deleteSelectedNode}>
                <Trash2 className="w-3.5 h-3.5" /> {t.delete}
              </button>
            )}
            <button
              className={`btn btn-xs btn-primary flex items-center gap-1 ${executing ? "loading" : ""}`}
              onClick={handleExecute}
              disabled={executing || nodes.length === 0}
            >
              <Play className="w-3.5 h-3.5" /> {executing ? t.running : t.run}
            </button>
          </div>
        </div>

        {/* React Flow Workspace */}
        <div className="flex-1 bg-base-200/50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Controls />
            <MiniMap style={{ height: 100, width: 140 }} zoomable pannable />
            <Background color="#cbd5e1" gap={16} />
          </ReactFlow>
        </div>

        {/* Execution Summary Overlay Banner */}
        {report && (
          <div className="absolute bottom-3 left-3 right-3 bg-base-100 border border-base-300 p-3 rounded-xl shadow-lg z-10 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              {report.success ? (
                <span className="text-success flex items-center gap-1 font-bold">
                  <CheckCircle className="w-4 h-4" /> {t.success}
                </span>
              ) : (
                <span className="text-error flex items-center gap-1 font-bold">
                  <AlertCircle className="w-4 h-4" /> {t.aborted}
                </span>
              )}
              <span className="text-base-content/50">|</span>
              {t.totalTime} <strong className="text-primary">{report.elapsedMs}ms</strong>
              {report.error && (
                <>
                  <span className="text-base-content/50">|</span>
                  <span className="text-error font-medium truncate max-w-[300px]">{report.error}</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Node Config / Result Details Panel (Right Side - 4 columns) */}
      <div className="lg:col-span-4 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col h-full overflow-hidden">
        {activeNode ? (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="border-b border-base-200 pb-2 mb-3 shrink-0 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-base-content/50 uppercase">{t.properties}</span>
                <h4 className="font-bold text-sm text-base-content/85 truncate">{activeNode.data.label}</h4>
              </div>
              <span className="text-[10px] bg-base-200 px-2 py-0.5 rounded text-mono">{activeNode.id}</span>
            </div>

            {/* Config Fields */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Type-specific configs */}
              {activeNode.type === "api" && (
                <div className="space-y-3 text-xs">
                  {/* Import Request Config */}
                  <div className="flex flex-col gap-1.5 p-2 bg-base-200/50 rounded-lg mb-2">
                    <label className="font-bold text-[9px] text-base-content/50 uppercase">{t.importRequest}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        className="btn btn-[10px] h-7 min-h-7 btn-outline btn-primary flex-1 py-0 px-2"
                        onClick={() => {
                          if (apiClientCurrentRequest) {
                            updateNodeConfig(activeNode.id, {
                              ...activeNode.data.config,
                              method: apiClientCurrentRequest.method,
                              url: apiClientCurrentRequest.url,
                              headers: apiClientCurrentRequest.headers,
                              body: apiClientCurrentRequest.body,
                            });
                          }
                        }}
                      >
                        {t.currentTester}
                      </button>

                      {apiClientHistory.length > 0 && (
                        <select
                          className="select select-bordered select-xs text-[10px] h-7 min-h-7 flex-1"
                          defaultValue=""
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            const item = apiClientHistory.find((h) => h.id === selectedId);
                            if (item) {
                              updateNodeConfig(activeNode.id, {
                                ...activeNode.data.config,
                                method: item.method,
                                url: item.url,
                                headers: item.headers,
                                body: item.body,
                              });
                            }
                            e.target.value = ""; // Reset
                          }}
                        >
                          <option value="" disabled>
                            {t.recentHistory}
                          </option>
                          {apiClientHistory.slice(0, 10).map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.method} {h.url.substring(0, 15)}...
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-base-content/75">Method</label>
                    <select
                      className="select select-bordered select-xs w-full text-xs font-bold"
                      value={(activeNode.data.config?.method as string) || "GET"}
                      onChange={(e) =>
                        updateNodeConfig(activeNode.id, { ...activeNode.data.config, method: e.target.value })
                      }
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-base-content/75">{t.requestUrl}</label>
                    <input
                      type="text"
                      className="input input-bordered input-xs font-mono w-full"
                      value={(activeNode.data.config?.url as string) || ""}
                      onChange={(e) =>
                        updateNodeConfig(activeNode.id, { ...activeNode.data.config, url: e.target.value })
                      }
                    />
                  </div>

                  {["POST", "PUT"].includes(String(activeNode.data.config?.method)) && (
                    <div className="flex flex-col gap-1">
                      <label className="font-semibold text-base-content/75">Body</label>
                      <textarea
                        rows={4}
                        className="textarea textarea-bordered textarea-xs font-mono w-full"
                        placeholder='{"key": "{{some_node.result}}"}'
                        value={(activeNode.data.config?.body as string) || ""}
                        onChange={(e) =>
                          updateNodeConfig(activeNode.id, { ...activeNode.data.config, body: e.target.value })
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {activeNode.type === "crypto" && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5 p-2 bg-base-200/50 rounded-lg text-xs">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-[10px] text-base-content/65 uppercase">{t.loadPreset}</label>
                    </div>
                    <select
                      className="select select-bordered select-xs w-full text-xs font-bold focus:outline-none"
                      value=""
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        if (!selectedId) {
                          return;
                        }
                        const found = savedCryptoPresets.find((p) => p.id === selectedId);
                        if (found) {
                          updateNodeConfig(activeNode.id, {
                            ...activeNode.data.config,
                            action: found.action,
                            key: found.key,
                            iv: found.iv,
                            payload: found.payload || activeNode.data.config?.payload || "",
                          });
                        }
                      }}
                    >
                      <option value="">{t.selectPreset}</option>
                      {savedCryptoPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.action})
                        </option>
                      ))}
                    </select>
                  </div>
                  <CryptoNode
                    isStandalone={false}
                    action={activeNode.data.config?.action as CryptoAction | undefined}
                    onChangeAction={(action) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, action })}
                    payload={activeNode.data.config?.payload as string | undefined}
                    onChangePayload={(payload) =>
                      updateNodeConfig(activeNode.id, { ...activeNode.data.config, payload })
                    }
                    secretKey={activeNode.data.config?.key as string | undefined}
                    onChangeSecretKey={(key) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, key })}
                    iv={activeNode.data.config?.iv as string | undefined}
                    onChangeIv={(iv) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, iv })}
                    customCode={activeNode.data.config?.code as string | undefined}
                    onChangeCustomCode={(code) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, code })}
                  />
                </div>
              )}

              {activeNode.type === "schema" && (
                <div className="space-y-3 text-xs">
                  <div className="flex flex-col gap-1.5 p-2 bg-base-200/50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-[10px] text-base-content/65 uppercase">
                        {t.importSchema}
                      </label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                          onClick={() =>
                            openSchemaEditor(true, undefined, (savedId) => {
                              const store = getDefaultStore();
                              const latestSchemas = store.get(savedJsonSchemasAtom);
                              const found = latestSchemas.find((s) => s.id === savedId);
                              if (found) {
                                updateNodeConfig(activeNode.id, {
                                  ...activeNode.data.config,
                                  schemaId: savedId,
                                  schema: found.schemaText,
                                });
                              }
                            })
                          }
                        >
                          {t.create}
                        </button>
                        {Boolean(activeNode.data.config?.schemaId) && (
                          <button
                            type="button"
                            className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                            onClick={() =>
                              openSchemaEditor(
                                false,
                                activeNode.data.config?.schemaId as string | undefined,
                                (savedId) => {
                                  const store = getDefaultStore();
                                  const latestSchemas = store.get(savedJsonSchemasAtom);
                                  const found = latestSchemas.find((s) => s.id === savedId);
                                  if (found) {
                                    updateNodeConfig(activeNode.id, {
                                      ...activeNode.data.config,
                                      schemaId: savedId,
                                      schema: found.schemaText,
                                    });
                                  }
                                },
                              )
                            }
                          >
                            {t.edit}
                          </button>
                        )}
                      </div>
                    </div>
                    <select
                      className="select select-bordered select-xs w-full text-xs font-bold focus:outline-none"
                      value={(activeNode.data.config?.schemaId as string) || ""}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        const found = savedJsonSchemas.find((s) => s.id === selectedId);
                        if (found) {
                          updateNodeConfig(activeNode.id, {
                            ...activeNode.data.config,
                            schemaId: selectedId,
                            schema: found.schemaText,
                          });
                        } else {
                          updateNodeConfig(activeNode.id, {
                            ...activeNode.data.config,
                            schemaId: "",
                          });
                        }
                      }}
                    >
                      <option value="">{t.selectSchema}</option>
                      {savedJsonSchemas.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-base-content/75">{t.payloadData}</label>
                    <textarea
                      rows={4}
                      className="textarea textarea-bordered textarea-xs font-mono w-full"
                      value={(activeNode.data.config?.payload as string) || ""}
                      onChange={(e) =>
                        updateNodeConfig(activeNode.id, { ...activeNode.data.config, payload: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-base-content/75">{t.schemaToValidate}</label>
                    <textarea
                      rows={6}
                      className="textarea textarea-bordered textarea-xs font-mono w-full"
                      value={(activeNode.data.config?.schema as string) || ""}
                      onChange={(e) =>
                        updateNodeConfig(activeNode.id, { ...activeNode.data.config, schema: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}

              {activeNode.type === "mapper" &&
                (() => {
                  // 1. Create context object for editor from previous node execution results
                  const editorContext: Record<string, unknown> = {};
                  if (report) {
                    report.results.forEach((res) => {
                      try {
                        editorContext[res.nodeId] = JSON.parse(res.output);
                      } catch {
                        editorContext[res.nodeId] = res.output;
                      }
                    });
                  }

                  // 2. Find connected downstream Schema node to autocomplete targetKey
                  const outgoingEdges = edges.filter((e) => e.source === activeNode.id);
                  const downstreamNodes = outgoingEdges.map((e) => nodes.find((n) => n.id === e.target));
                  const connectedSchemaNode = downstreamNodes.find((n) => n && n.type === "schema");
                  let schemaProperties: string[] = [];
                  if (connectedSchemaNode) {
                    try {
                      const parsedSchema = JSON.parse((connectedSchemaNode.data.config?.schema as string) || "{}");
                      if (parsedSchema && typeof parsedSchema.properties === "object") {
                        schemaProperties = Object.keys(parsedSchema.properties);
                      }
                    } catch {
                      // ignore invalid JSON schema string parsing
                    }
                  }
                  const customTargetKeySuggestions = schemaProperties.map((prop) => ({
                    label: prop,
                    insertText: prop,
                    detail: "schema prop",
                  }));

                  return (
                    <div className="space-y-3 text-xs flex flex-col h-full overflow-hidden">
                      <div className="flex items-center justify-between shrink-0">
                        <label className="font-semibold text-base-content/75 flex items-center gap-1">
                          <Shuffle className="w-3.5 h-3.5 text-info" /> {t.mappingsTitle}
                        </label>
                        <div className="flex gap-1.5">
                          {report && (
                            <button
                              type="button"
                              className="btn btn-xs btn-outline btn-info flex items-center gap-1 font-bold text-[10px]"
                              onClick={autoImportKeys}
                            >
                              {t.autoImport}
                            </button>
                          )}
                          <button
                            className="btn btn-xs btn-outline btn-primary flex items-center gap-1"
                            onClick={() => {
                              const currentMappings = ((activeNode.data.config?.mappings as unknown[]) || []) as Array<{
                                targetKey: string;
                                sourceValue: string;
                              }>;
                              updateNodeConfig(activeNode.id, {
                                ...activeNode.data.config,
                                mappings: [...currentMappings, { targetKey: "", sourceValue: "" }],
                              });
                            }}
                          >
                            <Plus className="w-3 h-3" /> {t.add}
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[350px]">
                        {(
                          ((activeNode.data.config?.mappings as unknown[]) || []) as Array<{
                            targetKey: string;
                            sourceValue: string;
                          }>
                        ).map((m, idx) => (
                          <div
                            key={idx}
                            className="flex gap-2 items-center p-2.5 bg-base-200/50 rounded-xl border border-base-300 relative group"
                          >
                            <div className="flex-1 space-y-1.5 min-w-0">
                              <div>
                                <span className="text-[9px] font-bold text-base-content/50 uppercase tracking-wider">
                                  {t.targetKey}
                                </span>
                                <TsCodeEditor
                                  value={m.targetKey}
                                  onChange={(val) => {
                                    const newMappings = [
                                      ...(((activeNode.data.config?.mappings as unknown[]) || []) as Array<{
                                        targetKey: string;
                                        sourceValue: string;
                                      }>),
                                    ];
                                    newMappings[idx] = { ...newMappings[idx], targetKey: val };
                                    updateNodeConfig(activeNode.id, {
                                      ...activeNode.data.config,
                                      mappings: newMappings,
                                    });
                                  }}
                                  customSuggestions={customTargetKeySuggestions}
                                  placeholder="e.g. title"
                                  rows={1}
                                  theme={theme}
                                  className="mt-0.5"
                                />
                              </div>
                              <div>
                                <span className="text-[9px] font-bold text-base-content/50 uppercase tracking-wider">
                                  {t.sourceValue}
                                </span>
                                <TsCodeEditor
                                  value={m.sourceValue}
                                  onChange={(val) => {
                                    const newMappings = [
                                      ...(((activeNode.data.config?.mappings as unknown[]) || []) as Array<{
                                        targetKey: string;
                                        sourceValue: string;
                                      }>),
                                    ];
                                    newMappings[idx] = { ...newMappings[idx], sourceValue: val };
                                    updateNodeConfig(activeNode.id, {
                                      ...activeNode.data.config,
                                      mappings: newMappings,
                                    });
                                  }}
                                  context={editorContext}
                                  placeholder="e.g. {{api_1.body.title}}"
                                  rows={1}
                                  theme={theme}
                                  className="mt-0.5"
                                />
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost btn-xs text-error/70 p-0 w-6 h-6 hover:bg-error/15 shrink-0 self-end mb-1"
                              onClick={() => {
                                const rawMappings = (activeNode.data.config?.mappings as unknown[]) || [];
                                const newMappings = rawMappings.filter((_: unknown, i: number) => i !== idx);
                                updateNodeConfig(activeNode.id, { ...activeNode.data.config, mappings: newMappings });
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        {((activeNode.data.config?.mappings as unknown[]) || []).length === 0 && (
                          <div className="text-center py-6 text-base-content/40 italic">{t.noMappings}</div>
                        )}
                      </div>

                      {/* Live Mapping Preview */}
                      {report && (
                        <div className="pt-2 border-t border-base-200 shrink-0 space-y-1">
                          <label className="font-semibold text-[10px] text-base-content/65 uppercase flex items-center gap-1">
                            {t.liveMapping}
                          </label>
                          {(() => {
                            const previewResult = resolveInterpolatedValue(
                              { mappings: activeNode.data.config?.mappings || [] },
                              report.results,
                            ) as { mappings?: Array<{ targetKey: string; sourceValue: string }> } | null;
                            const mappedObj: Record<string, unknown> = {};
                            if (previewResult && Array.isArray(previewResult.mappings)) {
                              previewResult.mappings.forEach((m) => {
                                if (m.targetKey && m.targetKey.trim() !== "") {
                                  mappedObj[m.targetKey.trim()] = m.sourceValue;
                                }
                              });
                            }
                            return (
                              <textarea
                                className="w-full p-2 bg-base-200 border border-base-300 rounded font-mono text-[9px] h-[90px] resize-none outline-none focus:outline-none focus:ring-0 text-success-content/80"
                                value={JSON.stringify(mappedObj, null, 2)}
                                readOnly
                              />
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {activeNode.type === "preview" && (
                <div className="space-y-3 text-xs flex flex-col h-full overflow-hidden">
                  <div className="grid grid-cols-2 gap-2 bg-base-200/50 p-2 rounded-xl shrink-0">
                    <div className="flex flex-col gap-1">
                      <label className="font-semibold text-[10px] text-base-content/65 uppercase">
                        {t.loadComponent}
                      </label>
                      <select
                        className="select select-bordered select-xs w-full text-xs font-bold focus:outline-none"
                        defaultValue=""
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          const found = savedComponents.find((c) => c.id === selectedId);
                          if (found) {
                            updateNodeConfig(activeNode.id, {
                              ...activeNode.data.config,
                              code: found.code,
                              schemaId: found.schemaId || "",
                            });
                          }
                          e.target.value = ""; // reset
                        }}
                      >
                        <option value="">{t.selectComponent}</option>
                        {savedComponents.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* JSON Schema validation selection */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <label className="font-semibold text-[10px] text-base-content/65 uppercase">
                          {t.selectValidationSchema}
                        </label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                            onClick={() =>
                              openSchemaEditor(true, undefined, (savedId) => {
                                updateNodeConfig(activeNode.id, {
                                  ...activeNode.data.config,
                                  schemaId: savedId,
                                });
                              })
                            }
                          >
                            {t.create}
                          </button>
                          {Boolean(activeNode.data.config?.schemaId) && (
                            <button
                              type="button"
                              className="text-[9px] hover:text-primary font-bold text-base-content/40 cursor-pointer"
                              onClick={() =>
                                openSchemaEditor(
                                  false,
                                  activeNode.data.config?.schemaId as string | undefined,
                                  (savedId) => {
                                    updateNodeConfig(activeNode.id, {
                                      ...activeNode.data.config,
                                      schemaId: savedId,
                                    });
                                  },
                                )
                              }
                            >
                              {t.edit}
                            </button>
                          )}
                        </div>
                      </div>
                      <select
                        className="select select-bordered select-xs w-full text-xs font-bold focus:outline-none"
                        value={(activeNode.data.config?.schemaId as string) || ""}
                        onChange={(e) => {
                          updateNodeConfig(activeNode.id, {
                            ...activeNode.data.config,
                            schemaId: e.target.value,
                          });
                        }}
                      >
                        <option value="">{t.noSchema}</option>
                        {savedJsonSchemas.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0 h-[260px]">
                    <label className="font-semibold text-base-content/75">{t.reactSource}</label>
                    {(() => {
                      let schemaText = "";
                      if (activeNode.data.config.schemaId) {
                        const foundSchema = savedJsonSchemas.find((s) => s.id === activeNode.data.config.schemaId);
                        if (foundSchema) {
                          schemaText = foundSchema.schemaText;
                        }
                      }

                      const incomingEdge = edges.find((e) => e.target === activeNode.id);
                      let previewData: unknown = null;

                      if (incomingEdge && report) {
                        const parentResult = report.results.find((r) => r.nodeId === incomingEdge.source);
                        if (parentResult?.success) {
                          try {
                            previewData = JSON.parse(parentResult.output);
                            if (
                              previewData &&
                              typeof previewData === "object" &&
                              "result" in (previewData as Record<string, unknown>)
                            ) {
                              previewData = (previewData as Record<string, unknown>).result;
                            }
                          } catch {
                            previewData = parentResult.output;
                          }
                        }
                      }

                      let mockDataObj: Record<string, unknown> = {};
                      if (previewData && typeof previewData === "object" && !Array.isArray(previewData)) {
                        mockDataObj = previewData as Record<string, unknown>;
                      } else if (schemaText) {
                        try {
                          const schemaObj = JSON.parse(schemaText);
                          if (schemaObj && typeof schemaObj.properties === "object") {
                            Object.keys(schemaObj.properties).forEach((k) => {
                              mockDataObj[k] = "";
                            });
                          }
                        } catch {}
                      }

                      const editorContext = { props: mockDataObj };
                      const customSuggestions = Object.keys(mockDataObj).map((key) => ({
                        label: key,
                        insertText: key,
                        detail: `prop (${typeof mockDataObj[key]})`,
                      }));

                      return (
                        <TsCodeEditor
                          value={(activeNode.data.config?.code as string) || ""}
                          onChange={(val) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, code: val })}
                          language="typescript"
                          context={editorContext}
                          customSuggestions={customSuggestions}
                          theme={theme}
                          className="flex-1 min-h-[220px]"
                        />
                      );
                    })()}
                  </div>

                  {/* Inline Live Previewer inside config panel */}
                  <div className="flex-1 min-h-[300px] border border-base-200 rounded-xl overflow-hidden flex flex-col mt-2">
                    <div className="bg-base-200/50 p-2 border-b border-base-200 text-[10px] font-bold text-base-content/60 flex items-center justify-between shrink-0">
                      <span>{t.liveRender}</span>
                      <span className="badge badge-outline badge-xs text-primary">Dynamic Props</span>
                    </div>
                    <div className="flex-1 bg-white relative">
                      {(() => {
                        const incomingEdge = edges.find((e) => e.target === activeNode.id);
                        let previewData: unknown = null;

                        if (incomingEdge && report) {
                          const parentResult = report.results.find((r) => r.nodeId === incomingEdge.source);
                          if (parentResult?.success) {
                            try {
                              previewData = JSON.parse(parentResult.output);
                              if (
                                previewData &&
                                typeof previewData === "object" &&
                                "result" in (previewData as Record<string, unknown>)
                              ) {
                                previewData = (previewData as Record<string, unknown>).result;
                              }
                            } catch {
                              previewData = parentResult.output;
                            }
                          }
                        }

                        // Retrieve active JSON Schema raw text for validation warning
                        let schemaText = "";
                        if (activeNode.data.config?.schemaId) {
                          const foundSchema = savedJsonSchemas.find((s) => s.id === activeNode.data.config?.schemaId);
                          if (foundSchema) {
                            schemaText = foundSchema.schemaText;
                          }
                        }

                        return (
                          <LivePreviewer
                            key={activeNode.id + (report ? "_ran" : "")}
                            code={(activeNode.data.config?.code as string) || ""}
                            initialData={previewData}
                            schemaText={schemaText}
                          />
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {activeNode.type === "script" && (
                <div className="space-y-3 text-xs flex flex-col h-full overflow-hidden">
                  <div className="flex flex-col gap-1 shrink-0">
                    <label className="font-semibold text-base-content/75 flex items-center gap-1">
                      <FileCode className="w-3.5 h-3.5 text-accent" /> {t.customJs}
                    </label>
                    <p className="text-[10px] text-base-content/50 leading-relaxed">
                      {t.customJsHint1}
                      <br />
                      {t.customJsHint2}
                    </p>
                  </div>
                  <div className="flex-1 min-h-[300px] flex flex-col gap-1">
                    <TsCodeEditor
                      value={(activeNode.data.config?.code as string) || ""}
                      onChange={(val) => updateNodeConfig(activeNode.id, { ...activeNode.data.config, code: val })}
                      language="javascript"
                      theme={theme}
                      className="flex-1"
                    />
                  </div>
                </div>
              )}

              {/* Common Config: Error Policy */}
              <div className="flex flex-col gap-1 pt-2 border-t border-base-200">
                <label className="font-semibold text-xs text-base-content/75">{t.errorPolicy}</label>
                <select
                  className="select select-bordered select-xs w-full text-xs"
                  value={(activeNode.data.config?.errorPolicy as string) || "fastFail"}
                  onChange={(e) =>
                    updateNodeConfig(activeNode.id, { ...activeNode.data.config, errorPolicy: e.target.value })
                  }
                >
                  <option value="fastFail">{t.fastFail}</option>
                  <option value="continueOnError">{t.continueOnError}</option>
                  <option value="retry">{t.retry}</option>
                </select>
              </div>

              {/* Dynamic Mapping Guide Helper */}
              {variableCandidates.length > 0 && (
                <div className="pt-3 border-t border-base-200 space-y-2">
                  <label className="font-semibold text-xs text-base-content/75 flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5 text-primary" /> {t.copyMapping}
                  </label>
                  <div className="text-[10px] text-base-content/50 leading-relaxed mb-2">{t.copyMappingHint}</div>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {variableCandidates.map((c) => {
                      const runRes = report?.results.find((r) => r.nodeId === c.id);
                      let parsedOutput: Record<string, unknown> | null = null;
                      if (runRes?.success) {
                        try {
                          const parsed = JSON.parse(runRes.output);
                          if (parsed && typeof parsed === "object") {
                            parsedOutput = parsed as Record<string, unknown>;
                          }
                        } catch {
                          parsedOutput = null;
                        }
                      }

                      return c.paths.map((p) => {
                        const pathStr = `{{${c.id}.${p}}}`;
                        let resolvedVal = "";
                        if (parsedOutput && typeof parsedOutput === "object") {
                          const val = parsedOutput[p];
                          resolvedVal = typeof val === "object" ? JSON.stringify(val) : String(val);
                        }

                        return (
                          <div
                            key={pathStr}
                            className="flex flex-col bg-base-200 p-2 rounded text-mono text-[10px] gap-1 border border-base-300"
                          >
                            <div className="flex justify-between items-center w-full">
                              <span className="text-primary truncate mr-2 font-bold">{pathStr}</span>
                              <button
                                className="btn btn-[10px] btn-ghost btn-xs text-primary/80 uppercase hover:bg-base-300 font-bold"
                                onClick={() => navigator.clipboard.writeText(pathStr)}
                              >
                                {t.copy}
                              </button>
                            </div>
                            {resolvedVal !== "" && (
                              <div className="text-[9px] text-base-content/60 bg-base-300/40 p-1 rounded font-mono truncate max-w-full">
                                <span className="font-semibold text-base-content/40 mr-1">{t.currentValue}</span>
                                {resolvedVal}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })}
                  </div>
                </div>
              )}

              {/* Execution Result view */}
              {report && (
                <div className="pt-3 border-t border-base-200 space-y-2 text-xs">
                  <label className="font-semibold text-xs text-base-content/75">{t.nodeResult}</label>
                  {(() => {
                    const nodeRes = report.results.find((r: NodeExecutionResult) => r.nodeId === activeNode.id);
                    if (!nodeRes) {
                      return <div className="text-base-content/40 italic">{t.notRun}</div>;
                    }
                    return (
                      <div className="space-y-2">
                        <div className="flex gap-2 items-center justify-between">
                          <div className="flex gap-2">
                            <span
                              className={`badge badge-xs font-bold ${nodeRes.success ? "badge-success text-success-content" : "badge-error text-error-content"}`}
                            >
                              {nodeRes.success ? t.succeeded : t.failed}
                            </span>
                            <span className="text-[10px] text-base-content/50">{t.elapsed(nodeRes.elapsedMs)}</span>
                          </div>

                          {/* Tabs for Input / Output */}
                          <div className="tabs tabs-boxed py-0 px-0.5 h-6 bg-base-200 gap-0.5 rounded-md flex shrink-0 border border-base-300">
                            <button
                              type="button"
                              className={`tab tab-xs h-5 min-h-[20px] px-2 text-[9px] font-bold rounded-md transition-all ${
                                resultTab === "input" ? "bg-white shadow-sm text-primary" : "text-base-content/60"
                              }`}
                              onClick={() => setResultTab("input")}
                            >
                              INPUT
                            </button>
                            <button
                              type="button"
                              className={`tab tab-xs h-5 min-h-[20px] px-2 text-[9px] font-bold rounded-md transition-all ${
                                resultTab === "output" ? "bg-white shadow-sm text-primary" : "text-base-content/60"
                              }`}
                              onClick={() => setResultTab("output")}
                            >
                              OUTPUT
                            </button>
                          </div>
                        </div>

                        {nodeRes.error && (
                          <div className="p-2 border border-error/20 bg-error/5 text-error rounded font-mono text-[10px]">
                            {nodeRes.error}
                          </div>
                        )}

                        {resultTab === "input" ? (
                          <div className="space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-base-content/50 uppercase font-semibold">
                                {t.interpolatedInput}
                              </span>
                            </div>
                            <textarea
                              className="w-full p-2 bg-base-200 border border-base-300 rounded font-mono text-[10px] h-[150px] resize-none outline-none focus:outline-none focus:ring-0 text-base-content/80"
                              value={JSON.stringify(
                                resolveInterpolatedValue(activeNode.data.config, report.results),
                                null,
                                2,
                              )}
                              readOnly
                            />
                          </div>
                        ) : (
                          (() => {
                            let outputObj: unknown = null;
                            try {
                              outputObj = JSON.parse(nodeRes.output);
                            } catch {
                              outputObj = nodeRes.output;
                            }
                            if (outputObj === null || outputObj === "null") {
                              return <div className="text-base-content/40 italic">{t.noOutput}</div>;
                            }

                            return (
                              <div className="space-y-1">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-base-content/50 uppercase font-semibold">
                                    {t.outputData}
                                  </span>
                                  <div className="flex gap-1.5">
                                    {onExportPreviewData && (
                                      <button
                                        type="button"
                                        className="btn btn-[10px] btn-ghost btn-xs text-success flex items-center gap-0.5"
                                        onClick={() => {
                                          const obj = outputObj as Record<string, unknown> | null;
                                          const previewVal =
                                            obj && typeof obj === "object" ? obj.body || obj.result || obj : outputObj;
                                          onExportPreviewData(previewVal);
                                        }}
                                      >
                                        {t.exportPreview} <ArrowRight className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-[10px] btn-ghost btn-xs"
                                      onClick={() =>
                                        navigator.clipboard.writeText(
                                          typeof outputObj === "object"
                                            ? JSON.stringify(outputObj, null, 2)
                                            : String(outputObj),
                                        )
                                      }
                                    >
                                      {t.copy}
                                    </button>
                                  </div>
                                </div>
                                <textarea
                                  className="w-full p-2 bg-base-200 border border-base-300 rounded font-mono text-[10px] h-[150px] resize-none outline-none focus:outline-none focus:ring-0 text-success-content/80"
                                  value={
                                    typeof outputObj === "object"
                                      ? JSON.stringify(outputObj, null, 2)
                                      : String(outputObj)
                                  }
                                  readOnly
                                />
                              </div>
                            );
                          })()
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-base-content/40 italic text-sm">
            <Settings className="w-12 h-12 text-base-content/20 mb-3 animate-spin duration-3000" />
            {t.selectNodeHint}
          </div>
        )}
      </div>
      <SchemaEditorModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        schemaId={schemaModalTargetId}
        onSave={(savedId) => {
          if (schemaModalCallback) {
            schemaModalCallback(savedId);
          }
        }}
      />
    </div>
  );
}
