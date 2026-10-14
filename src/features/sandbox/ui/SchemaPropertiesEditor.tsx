import { useAtomValue } from "jotai";
import { Copy, CornerDownRight, FileCode, Globe, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { languageAtom } from "@/entities/app";
import { apiClientLastResponseAtom } from "@/entities/sandbox";
import type { ApiLogEntry, Domain, DomainApiLoggingLink } from "@/shared/api";
import { commands, unwrap } from "@/shared/api";
import {
  type HttpMethod,
  type OpenApiSpec,
  type ParsedEndpoint,
  parseOpenApiSpec,
  type SchemaObject,
} from "@/shared/lib/openapi-parser";
import { toastError } from "@/shared/ui/toast";
import { importPropertiesFromJson as importPropertiesFromJsonShared } from "../lib/importPropertiesFromJson";

export interface SchemaProperty {
  id: string;
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "ref";
  description: string;
  required: boolean;
  parentId?: string;
}

export interface SchemaPropertiesEditorProps {
  properties: SchemaProperty[];
  onChange: (properties: SchemaProperty[]) => void;
}

const en = {
  properties: "Properties",
  addProperty: "Add Property",
  addRootProperty: "Add Root Property",
  propertyName: "Property Name",
  type: "Type",
  required: "Required",
  description: "Description",
  emptyProps: "No properties defined. Click Add Property to start building your schema.",
  apiResponse: "Import from API Response",
  importSchema: "Import Schema",
  openapiSource: "OpenAPI Spec Source",
  projectOpenapi: "Project OpenAPI",
  pasteDirectly: "Paste Directly",
  selectDomain: "Select Domain...",
  pastePlaceholder: "Paste OpenAPI JSON spec here...",
  importTarget: "Import Target Type",
  componentSchema: "Component Schema",
  endpointBody: "Endpoint Body",
  selectSchema: "Select Schema",
  selectEndpoint: "Select Endpoint",
  schemaOrBodyType: "Schema / Body",
  requestBody: "Request Body",
  responseBody: "Response Body (200 OK)",
  importNow: "Import Schema Structure",
  jsonSnippet: "Paste Raw JSON / Sample Response",
  jsonPlaceholder: 'Paste JSON payload here (e.g. { "id": 1, "name": "Horizon" })...',
  inferSchema: "Infer Schema",
  recentLogs: "Select from Recent API Logs",
  searchLogsPlaceholder: "Filter API logs by path, method, status...",
  apiLogSearchPlaceholder: "Filter API logs by path, method, status...",
  req: "REQ",
  res: "RES",
  reqBtn: "REQ",
  resBtn: "RES",
  noLogsFound: "No matching API logs found for today.",
  noApiLogs: "No matching API logs found.",
  noSchemas: "No component schemas found in OpenAPI spec.",
  dataType: "Data Type",
  reqBody: "Request Body",
  resBody: "Response Body",
  noEndpoints: "No endpoints found in OpenAPI spec.",
  jsonInputLabel: "JSON Payload Input",
  jsonSyntaxError: "JSON Syntax Error",
  analyzeImport: "Analyze and Import",
  noOpenapiLoaded: "Please select or load an OpenAPI spec first.",
  noComponentSelected: "Please select a component schema to import.",
  noEndpointSelected: "Please select an endpoint to import.",
  invalidJson: "Invalid JSON format. Please check your input.",
  failedSchemaContent: "Failed to load OpenAPI schema content for this domain.",
  parseOpenapiFailed: "Failed to parse OpenAPI specification",
  noMatchingDomains: "No domains with schemas linked in project settings.",
  pasteValidOpenapiFirst: "Paste a valid OpenAPI JSON spec first.",
  importOpenApi: "Import OpenAPI",
  pasteJson: "Paste JSON",
  pasteJsonDirect: "Paste JSON",
  recentApiLogs: "Recent API Logs",
  propertyNamePlaceholder: "Property name",
  addSubProperty: "Add sub property",
  extractFromResponse: "Extract sub properties from API response",
  deleteProperty: "Delete property (also removes nested items)",
  refType: "ref",
  invalidOpenApi: "This is not a valid OpenAPI schema (missing components.schemas).",
  missingTargetSchema: "The selected schema does not exist, or its body is empty.",
  extractRequest: "Extract schema from the request body",
  extractResponse: "Extract schema from the response body",
};

const ko: typeof en = {
  properties: "속성 목록",
  addProperty: "속성 추가",
  addRootProperty: "루트 속성 추가",
  propertyName: "속성명",
  type: "타입",
  required: "필수",
  description: "설명 / 포맷",
  emptyProps: "정의된 속성이 없습니다. 속성 추가 버튼을 눌러 스키마를 구성해보세요.",
  apiResponse: "API 응답에서 가져오기",
  importSchema: "스키마 가져오기 (가져오기 도구)",
  openapiSource: "OpenAPI 스펙 출처",
  projectOpenapi: "프로젝트 도메인 스펙",
  pasteDirectly: "JSON 스펙 직접 붙여넣기",
  selectDomain: "도메인 선택...",
  pastePlaceholder: "OpenAPI JSON 스펙 내용을 여기에 붙여넣으세요...",
  importTarget: "가져올 대상 유형",
  componentSchema: "컴포넌트 스키마 (Components)",
  endpointBody: "엔드포인트 바디 (Endpoints)",
  selectSchema: "스키마 선택",
  selectEndpoint: "엔드포인트 선택",
  schemaOrBodyType: "스키마/바디 유형",
  requestBody: "요청 바디 (Request Body)",
  responseBody: "응답 바디 (200 OK Response)",
  importNow: "스키마 구조 가져오기",
  jsonSnippet: "원시 JSON / 샘플 응답 붙여넣기",
  jsonPlaceholder: 'JSON 페이로드를 붙여넣으세요 (예: { "id": 1, "name": "Horizon" })...',
  inferSchema: "스키마 추론하기",
  recentLogs: "최근 API 로그에서 선택",
  searchLogsPlaceholder: "경로, 메서드, 상태 코드로 로그 검색...",
  apiLogSearchPlaceholder: "경로, 메서드, 상태 코드로 로그 검색...",
  req: "요청",
  res: "응답",
  reqBtn: "요청",
  resBtn: "응답",
  noLogsFound: "오늘 기록된 일치하는 API 로그가 없습니다.",
  noApiLogs: "기록된 일치하는 API 로그가 없습니다.",
  noSchemas: "OpenAPI 스펙에 컴포넌트 스키마가 없습니다.",
  dataType: "데이터 유형",
  reqBody: "요청 바디",
  resBody: "응답 바디",
  noEndpoints: "OpenAPI 스펙에 엔드포인트가 없습니다.",
  jsonInputLabel: "JSON 페이로드 입력",
  jsonSyntaxError: "JSON 문법 오류",
  analyzeImport: "분석 및 가져오기",
  noOpenapiLoaded: "먼저 OpenAPI 스펙을 선택하거나 로드해주세요.",
  noComponentSelected: "가져올 컴포넌트 스키마를 선택해주세요.",
  noEndpointSelected: "가져올 엔드포인트를 선택해주세요.",
  invalidJson: "올바른 JSON 형식이 아닙니다. 입력값을 확인해주세요.",
  failedSchemaContent: "이 도메인의 OpenAPI 스키마 내용을 가져오는 데 실패했습니다.",
  parseOpenapiFailed: "OpenAPI 스펙 파싱 실패",
  noMatchingDomains: "설정에 스키마가 연결된 도메인이 없습니다.",
  pasteValidOpenapiFirst: "유효한 OpenAPI JSON 스펙을 먼저 붙여넣어 주세요.",
  importOpenApi: "OpenAPI 가져오기",
  pasteJson: "JSON 붙여넣기",
  pasteJsonDirect: "JSON 직접 붙여넣기",
  recentApiLogs: "최근 API 로그",
  propertyNamePlaceholder: "속성명 (예: user)",
  addSubProperty: "하위 속성 추가",
  extractFromResponse: "API 응답에서 하위 속성 추출",
  deleteProperty: "속성 삭제 (하위 속성도 함께 삭제됩니다)",
  refType: "ref (참조)",
  invalidOpenApi: "올바른 OpenAPI 스키마 구조가 아닙니다 (components.schemas가 없음).",
  missingTargetSchema: "선택한 대상 스키마가 존재하지 않거나 바디 정의가 비어 있습니다.",
  extractRequest: "요청 바디에서 스키마 추출",
  extractResponse: "응답 바디에서 스키마 추출",
};

export function SchemaPropertiesEditor({ properties, onChange }: SchemaPropertiesEditorProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;

  const apiClientLastResponse = useAtomValue(apiClientLastResponseAtom);

  // Unified Import Dashboard states
  const [activeImportTab, setActiveImportTab] = useState<"logs" | "openapi" | "json" | null>(null);
  const [rawJsonInput, setRawJsonInput] = useState("");

  // OpenAPI Import states
  const [domains, setDomains] = useState<Domain[]>([]);
  const [links, setLinks] = useState<DomainApiLoggingLink[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<number | "">("");
  const [openApiSpecJson, setOpenApiSpecJson] = useState<OpenApiSpec | null>(null);
  const [availableOpenApiSchemas, setAvailableOpenApiSchemas] = useState<string[]>([]);
  const [selectedOpenApiSchema, setSelectedOpenApiSchema] = useState<string>("");
  const [openApiActiveTab, setOpenApiActiveTab] = useState<"project" | "paste">("project");
  const [rawOpenApiInput, setRawOpenApiInput] = useState<string>("");

  // New States for Endpoint imports
  const [openApiImportType, setOpenApiImportType] = useState<"component" | "endpoint">("component");
  const [openApiEndpoints, setOpenApiEndpoints] = useState<ParsedEndpoint[]>([]);
  const [selectedEndpointKey, setSelectedEndpointKey] = useState<string>(""); // "method:path"
  const [openApiIoType, setOpenApiIoType] = useState<"request" | "response">("response");

  // API Log Autocomplete import states
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [apiLogSearchQuery, setApiLogSearchQuery] = useState("");

  // Load project domains for OpenAPI import
  useEffect(() => {
    if (activeImportTab === "openapi" && openApiActiveTab === "project") {
      (async () => {
        try {
          const [dRes, lRes] = await Promise.all([
            commands.getDomains().then(unwrap),
            commands.getDomainApiLoggingLinks().then(unwrap),
          ]);
          if (dRes.success) {
            setDomains(dRes.data ?? []);
          }
          if (lRes.success) {
            setLinks(lRes.data ?? []);
          }
        } catch (e) {
          console.error("Failed to load domains for OpenAPI import:", e);
        }
      })();
    }
  }, [activeImportTab, openApiActiveTab]);

  // Filter domains that have schema links
  const schemaLinks = useMemo(() => links.filter((l) => l.schemaUrl), [links]);

  const domainMap = useMemo(() => {
    const m = new Map<number, Domain>();
    for (const d of domains) {
      m.set(d.id, d);
    }
    return m;
  }, [domains]);

  // Populate schema and endpoint dropdown lists
  const populateOpenApiOptions = useCallback((spec: OpenApiSpec) => {
    setOpenApiSpecJson(spec);
    if (spec.components?.schemas) {
      const schemaNames = Object.keys(spec.components.schemas).sort();
      setAvailableOpenApiSchemas(schemaNames);
      if (schemaNames.length > 0) {
        setSelectedOpenApiSchema(schemaNames[0]);
      }
    } else {
      setAvailableOpenApiSchemas([]);
      setSelectedOpenApiSchema("");
    }

    try {
      const { endpoints } = parseOpenApiSpec(JSON.stringify(spec));
      setOpenApiEndpoints(endpoints || []);
      if (endpoints && endpoints.length > 0) {
        setSelectedEndpointKey(`${endpoints[0].method}:${endpoints[0].path}`);
      } else {
        setSelectedEndpointKey("");
      }
    } catch (_e) {
      setOpenApiEndpoints([]);
      setSelectedEndpointKey("");
    }
  }, []);

  // Load schema when domain is selected
  useEffect(() => {
    if (!selectedDomainId) {
      setOpenApiSpecJson(null);
      setAvailableOpenApiSchemas([]);
      setSelectedOpenApiSchema("");
      setOpenApiEndpoints([]);
      setSelectedEndpointKey("");
      return;
    }

    (async () => {
      try {
        const res = await commands.getApiSchemaContent({ domainId: Number(selectedDomainId) }).then(unwrap);
        if (res.success && res.data) {
          const spec = JSON.parse(res.data);
          populateOpenApiOptions(spec);
        } else {
          toastError(t.failedSchemaContent);
        }
      } catch (e) {
        toastError(`${t.parseOpenapiFailed}: ${e}`);
      }
    })();
  }, [selectedDomainId, populateOpenApiOptions, t]);

  // Parse pasted OpenAPI input
  useEffect(() => {
    if (openApiActiveTab === "paste" && rawOpenApiInput.trim()) {
      try {
        const spec = JSON.parse(rawOpenApiInput);
        populateOpenApiOptions(spec);
      } catch (_e) {
        setOpenApiSpecJson(null);
        setAvailableOpenApiSchemas([]);
        setSelectedOpenApiSchema("");
        setOpenApiEndpoints([]);
        setSelectedEndpointKey("");
      }
    }
  }, [rawOpenApiInput, openApiActiveTab, populateOpenApiOptions]);

  // Fetch API logs when log search panel is opened
  useEffect(() => {
    if (activeImportTab === "logs") {
      (async () => {
        try {
          const today = new Date().toISOString().split("T")[0];
          const res = await commands
            .getApiLogs({
              date: today,
              domainFilter: null,
              methodFilter: null,
              hostFilter: null,
              exactMatch: false,
            })
            .then(unwrap);
          if (res.success) {
            setApiLogs(res.data ?? []);
          }
        } catch (e) {
          console.error("Failed to load API logs for import:", e);
        }
      })();
    }
  }, [activeImportTab]);

  const filteredApiLogs = useMemo(() => {
    const q = apiLogSearchQuery.toLowerCase().trim();
    if (!q) {
      return apiLogs.slice(0, 30);
    }
    return apiLogs.filter(
      (log) =>
        (log.method || "").toLowerCase().includes(q) ||
        (log.path || "").toLowerCase().includes(q) ||
        (log.status_code?.toString() || "").includes(q) ||
        (log.url || "").toLowerCase().includes(q),
    );
  }, [apiLogs, apiLogSearchQuery]);

  const isValidJson = (str: string | null | undefined): boolean => {
    if (!str) {
      return false;
    }
    try {
      const parsed = JSON.parse(str);
      return typeof parsed === "object" && parsed !== null;
    } catch (_e) {
      return false;
    }
  };

  const handleImportJsonStr = (str: string) => {
    try {
      const parsed = JSON.parse(str);
      importFromJson(parsed);
      setActiveImportTab(null);
      setApiLogSearchQuery("");
    } catch (_e) {
      toastError(t.invalidJson);
    }
  };

  const handleImportFromLog = async (logId: string, which: "request" | "response") => {
    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await commands.getApiLogDetail({ id: logId, date: today }).then(unwrap);
      const body = which === "request" ? res.data?.request_body : res.data?.response_body;
      if (!body || !isValidJson(body)) {
        toastError(t.invalidJson);
        return;
      }
      handleImportJsonStr(body);
    } catch (e) {
      console.error(e);
      toastError(t.invalidJson);
    }
  };

  // Helper to extract nested schema block from endpoints
  const getEndpointSchema = (
    spec: OpenApiSpec,
    path: string,
    method: string,
    type: "request" | "response",
  ): SchemaObject | null => {
    const operation = spec.paths?.[path]?.[method.toLowerCase() as HttpMethod];
    if (!operation) {
      return null;
    }

    if (type === "request") {
      const requestBody = operation.requestBody;
      if (!requestBody) {
        return null;
      }
      let rb = requestBody;
      if (requestBody.$ref) {
        const prefix = "#/components/requestBodies/";
        if (requestBody.$ref.startsWith(prefix)) {
          const name = requestBody.$ref.slice(prefix.length);
          const bodies = spec.components?.requestBodies as Record<string, typeof requestBody> | undefined;
          rb = bodies?.[name] ?? requestBody;
        }
      }
      const content = rb?.content;
      const mediaType =
        content?.["application/json"] ||
        content?.["*/*"] ||
        content?.["application/x-www-form-urlencoded"] ||
        (content ? Object.values(content)[0] : undefined);
      return mediaType?.schema || null;
    } else {
      const responses = operation.responses || {};
      const successCode = Object.keys(responses).find((code) => code.startsWith("2")) || "default";
      let resp = responses[successCode];
      if (resp?.$ref) {
        const prefix = "#/components/responses/";
        if (resp.$ref.startsWith(prefix)) {
          const name = resp.$ref.slice(prefix.length);
          const componentResponses = spec.components?.responses as Record<string, typeof resp> | undefined;
          resp = componentResponses?.[name] ?? resp;
        }
      }
      const content = resp?.content;
      const mediaType =
        content?.["application/json"] || content?.["*/*"] || (content ? Object.values(content)[0] : undefined);
      return mediaType?.schema || null;
    }
  };

  // Recursive OpenAPI Schema to SchemaProperty list parser
  const importFromOpenApiSpec = (
    spec: OpenApiSpec,
    target:
      | { type: "component"; name: string }
      | { type: "endpoint"; path: string; method: string; io: "request" | "response" },
  ) => {
    if (!spec) {
      return null;
    }

    let rootSchema: SchemaObject | null = null;
    if (target.type === "component") {
      if (!spec.components || !spec.components.schemas) {
        toastError(t.invalidOpenApi);
        return null;
      }
      rootSchema = spec.components.schemas[target.name];
    } else {
      rootSchema = getEndpointSchema(spec, target.path, target.method, target.io);
    }

    if (!rootSchema) {
      toastError(t.missingTargetSchema);
      return null;
    }

    const parsedProps: SchemaProperty[] = [];
    const processedDefs = new Set<string>();
    const defsToProcess: string[] = [];
    const genId = () => Math.random().toString(36).substring(2, 9);

    const parseNode = (schema: SchemaObject, name: string, parentId: string | undefined, isRequired: boolean) => {
      const propId = genId();

      if (schema?.$ref) {
        const refPath = schema.$ref;
        let targetRef = refPath;
        if (refPath.startsWith("#/components/schemas/")) {
          const modelName = refPath.replace("#/components/schemas/", "");
          targetRef = `#/definitions/${modelName}`;
          if (!processedDefs.has(modelName)) {
            defsToProcess.push(modelName);
          }
        }
        parsedProps.push({
          id: propId,
          name,
          type: "ref",
          description: targetRef,
          required: isRequired,
          parentId,
        });
        return;
      }

      const type = schema?.type || "string";
      const desc = schema?.description || "";

      parsedProps.push({
        id: propId,
        name,
        type: type === "integer" ? "integer" : (type as SchemaProperty["type"]),
        description: desc,
        required: isRequired,
        parentId,
      });

      if (type === "object" && schema.properties) {
        const requiredFields = schema.required || [];
        Object.entries(schema.properties).forEach(([childName, childSchema]) => {
          parseNode(childSchema, childName, propId, requiredFields.includes(childName));
        });
      } else if (type === "array" && schema.items) {
        parseNode(schema.items, "", propId, false);
      }
    };

    if (rootSchema.type === "object" && rootSchema.properties) {
      const requiredFields = rootSchema.required || [];
      Object.entries(rootSchema.properties).forEach(([name, schema]) => {
        parseNode(schema, name, undefined, requiredFields.includes(name));
      });
    } else {
      parseNode(rootSchema, target.type === "component" ? target.name : "root", undefined, false);
    }

    let definitionsId: string | undefined;

    while (defsToProcess.length > 0) {
      const defName = defsToProcess.shift()!;
      if (processedDefs.has(defName)) {
        continue;
      }
      processedDefs.add(defName);

      const defSchema = spec.components?.schemas?.[defName];
      if (!defSchema) {
        continue;
      }

      if (!definitionsId) {
        definitionsId = genId();
        parsedProps.push({
          id: definitionsId,
          name: "definitions",
          type: "object",
          description: "Schema definitions block",
          required: false,
          parentId: undefined,
        });
      }

      const modelNodeId = genId();
      parsedProps.push({
        id: modelNodeId,
        name: defName,
        type: "object",
        description: defSchema.description || `Definition for ${defName}`,
        required: false,
        parentId: definitionsId,
      });

      if (defSchema.properties) {
        const requiredFields = defSchema.required || [];
        Object.entries(defSchema.properties).forEach(([name, schema]) => {
          parseNode(schema, name, modelNodeId, requiredFields.includes(name));
        });
      }
    }

    return parsedProps;
  };

  const handleImportFromOpenApi = () => {
    if (!openApiSpecJson) {
      toastError(t.noOpenapiLoaded);
      return;
    }

    let target:
      | { type: "component"; name: string }
      | { type: "endpoint"; path: string; method: string; io: "request" | "response" }
      | null = null;
    if (openApiImportType === "component") {
      if (!selectedOpenApiSchema) {
        toastError(t.noComponentSelected);
        return;
      }
      target = { type: "component", name: selectedOpenApiSchema };
    } else {
      if (!selectedEndpointKey) {
        toastError(t.noEndpointSelected);
        return;
      }
      const [method, path] = selectedEndpointKey.split(":");
      target = { type: "endpoint", path, method, io: openApiIoType };
    }

    const imported = importFromOpenApiSpec(openApiSpecJson, target);
    if (imported) {
      onChange(imported);
      setActiveImportTab(null);
      setRawOpenApiInput("");
      setSelectedDomainId("");
      setOpenApiSpecJson(null);
      setAvailableOpenApiSchemas([]);
      setSelectedOpenApiSchema("");
      setSelectedEndpointKey("");
    }
  };

  const importFromJson = (json: unknown, parentId?: string) => {
    if (!json || typeof json !== "object") {
      toastError(t.invalidJson);
      return;
    }

    const parsedProps = importPropertiesFromJsonShared(json);

    if (parentId) {
      const siblingNames = properties.filter((p) => p.parentId === parentId).map((p) => p.name);
      const uniqueNewProps = parsedProps.filter((np) => !siblingNames.includes(np.name));
      onChange([...properties, ...uniqueNewProps]);
    } else {
      onChange(parsedProps);
    }
  };

  // Order properties in tree hierarchy
  const orderedProperties = useMemo(() => {
    const orderTree = (props: SchemaProperty[], parentId: string | undefined): SchemaProperty[] => {
      const children = props.filter((p) => p.parentId === parentId);
      const result: SchemaProperty[] = [];
      for (const child of children) {
        result.push(child);
        const descendants = orderTree(props, child.id);
        result.push(...descendants);
      }
      return result;
    };
    return orderTree(properties, undefined);
  }, [properties]);

  // Compute indentation depth
  const getPropertyDepth = (prop: SchemaProperty): number => {
    let depth = 0;
    let current = prop;
    while (current.parentId) {
      const parent = properties.find((p) => p.id === current.parentId);
      if (!parent) {
        break;
      }
      depth += 1;
      current = parent;
    }
    return depth;
  };

  // Add a new property row at root
  const addProperty = () => {
    const newProp: SchemaProperty = {
      id: Math.random().toString(36).substring(2, 9),
      name: "",
      type: "string",
      description: "",
      required: false,
    };
    onChange([...properties, newProp]);
  };

  // Add a nested sub-property row
  const addSubProperty = (parentId: string) => {
    const newProp: SchemaProperty = {
      id: Math.random().toString(36).substring(2, 9),
      name: "",
      type: "string",
      description: "",
      required: false,
      parentId,
    };
    onChange([...properties, newProp]);
  };

  // Delete row recursively (deletes child nodes under it)
  const removeProperty = (id: string) => {
    const getDescendantIds = (parentId: string): string[] => {
      const children = properties.filter((p) => p.parentId === parentId);
      const ids = children.map((c) => c.id);
      for (const child of children) {
        ids.push(...getDescendantIds(child.id));
      }
      return ids;
    };

    const idsToRemove = [id, ...getDescendantIds(id)];
    onChange(properties.filter((p) => !idsToRemove.includes(p.id)));
  };

  const updateProperty = (id: string, field: keyof SchemaProperty, val: SchemaProperty[keyof SchemaProperty]) => {
    onChange(properties.map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Properties Headers */}
      <div className="border-b border-base-200 pb-2 flex items-center justify-between flex-wrap gap-2">
        <span className="font-bold text-xs text-base-content/65 uppercase">{t.properties}</span>
        <div className="flex flex-wrap gap-1.5 items-center justify-end">
          <button
            type="button"
            className={`btn btn-xs flex items-center gap-1.5 font-semibold transition-all ${
              activeImportTab === "openapi" ? "btn-primary shadow-sm" : "btn-outline btn-ghost hover:bg-base-200"
            }`}
            onClick={() => setActiveImportTab(activeImportTab === "openapi" ? null : "openapi")}
          >
            <FileCode className="w-3 h-3" /> {t.importOpenApi}
          </button>
          <button
            type="button"
            className={`btn btn-xs flex items-center gap-1.5 font-semibold transition-all ${
              activeImportTab === "json" ? "btn-primary shadow-sm" : "btn-outline btn-ghost hover:bg-base-200"
            }`}
            onClick={() => setActiveImportTab(activeImportTab === "json" ? null : "json")}
          >
            <Copy className="w-3 h-3" /> {t.pasteJson}
          </button>
          <button
            type="button"
            className={`btn btn-xs flex items-center gap-1.5 font-semibold transition-all ${
              activeImportTab === "logs" ? "btn-primary shadow-sm" : "btn-outline btn-ghost hover:bg-base-200"
            }`}
            onClick={() => setActiveImportTab(activeImportTab === "logs" ? null : "logs")}
          >
            <Globe className="w-3 h-3" /> {t.recentApiLogs}
          </button>
          <button className="btn btn-xs btn-primary flex items-center gap-1" onClick={addProperty}>
            <Plus className="w-3.5 h-3.5" /> {t.addProperty}
          </button>
        </div>
      </div>

      {activeImportTab !== null && (
        <div className="flex flex-col gap-3.5 border border-primary/15 bg-primary/5 backdrop-blur-md rounded-2xl p-4 animate-fadeIn shadow-md mt-1 mb-3">
          {/* Segmented Tab Control Header - Duplicated tab list is resolved here */}
          <div className="flex items-center justify-between border-b border-base-300/40 pb-2.5">
            <span className="text-xs font-bold text-base-content/85 flex items-center gap-1.5">
              {activeImportTab === "openapi" && (
                <>
                  <FileCode className="w-3.5 h-3.5 text-primary" />
                  {t.importOpenApi}
                </>
              )}
              {activeImportTab === "json" && (
                <>
                  <Copy className="w-3.5 h-3.5 text-primary" />
                  {t.pasteJsonDirect}
                </>
              )}
              {activeImportTab === "logs" && (
                <>
                  <Globe className="w-3.5 h-3.5 text-primary" />
                  {t.recentApiLogs}
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-xs text-base-content/40 hover:text-base-content"
              onClick={() => setActiveImportTab(null)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tab Body 1: API Logs */}
          {activeImportTab === "logs" && (
            <div className="flex flex-col gap-2.5">
              <div className="relative w-full">
                <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-base-content/40">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  className="input input-bordered input-xs w-full pl-7 text-xs font-semibold focus:outline-none"
                  placeholder={t.apiLogSearchPlaceholder}
                  value={apiLogSearchQuery}
                  onChange={(e) => setApiLogSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto border border-base-300/60 rounded-xl bg-base-100 p-1 divide-y divide-base-200/50 shadow-inner custom-scrollbar">
                {filteredApiLogs.length > 0 ? (
                  filteredApiLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-2 hover:bg-base-200/50 rounded-lg transition-colors text-[10px] gap-3"
                    >
                      <div className="flex items-center gap-2 truncate flex-1">
                        <span
                          className={`px-1.5 py-0.5 rounded-md font-black text-[8px] tracking-wide ${
                            log.method === "GET"
                              ? "bg-blue-500/10 text-blue-500"
                              : log.method === "POST"
                                ? "bg-green-500/10 text-green-500"
                                : log.method === "PUT"
                                  ? "bg-yellow-500/10 text-yellow-500"
                                  : "bg-red-500/10 text-red-500"
                          }`}
                        >
                          {log.method}
                        </span>
                        <span
                          className="font-semibold text-base-content/85 truncate font-mono text-[9.5px]"
                          title={log.url}
                        >
                          {log.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded-md font-bold text-[9px] ${
                            log.status_code && log.status_code >= 200 && log.status_code < 300
                              ? "bg-success/10 text-success"
                              : "bg-error/10 text-error"
                          }`}
                        >
                          {log.status_code || "---"}
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={!log.has_bodies}
                            onClick={() => void handleImportFromLog(log.id, "request")}
                            className="btn btn-outline btn-primary btn-[9px] px-2 h-6 min-h-0 text-[9px] font-bold rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                            title={t.extractRequest}
                          >
                            {t.reqBtn}
                          </button>
                          <button
                            type="button"
                            disabled={!log.has_bodies}
                            onClick={() => void handleImportFromLog(log.id, "response")}
                            className="btn btn-primary btn-[9px] px-2 h-6 min-h-0 text-[9px] font-bold rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                            title={t.extractResponse}
                          >
                            {t.resBtn}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="text-[10px] text-base-content/40 italic p-3 text-center">{t.noApiLogs}</span>
                )}
              </div>
            </div>
          )}

          {/* Tab Body 2: OpenAPI */}
          {activeImportTab === "openapi" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-base-content/40 uppercase">{t.openapiSource}</span>
                <div className="flex bg-base-200 p-0.5 rounded-xl border border-base-300/40">
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all ${
                      openApiActiveTab === "project"
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/60 hover:text-base-content"
                    }`}
                    onClick={() => {
                      setOpenApiActiveTab("project");
                      setOpenApiSpecJson(null);
                      setAvailableOpenApiSchemas([]);
                      setSelectedOpenApiSchema("");
                    }}
                  >
                    {t.projectOpenapi}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all ${
                      openApiActiveTab === "paste"
                        ? "bg-base-100 text-base-content shadow-sm"
                        : "text-base-content/60 hover:text-base-content"
                    }`}
                    onClick={() => {
                      setOpenApiActiveTab("paste");
                      setOpenApiSpecJson(null);
                      setAvailableOpenApiSchemas([]);
                      setSelectedOpenApiSchema("");
                    }}
                  >
                    {t.pasteDirectly}
                  </button>
                </div>
              </div>

              {openApiActiveTab === "project" ? (
                <div className="flex flex-col gap-1.5">
                  <select
                    className="select select-bordered select-xs w-full text-xs font-semibold"
                    value={selectedDomainId}
                    onChange={(e) => setSelectedDomainId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">{t.selectDomain}</option>
                    {schemaLinks.map((link) => {
                      const d = domainMap.get(link.domainId);
                      return (
                        <option key={link.domainId} value={link.domainId}>
                          {d?.url ?? `Domain #${link.domainId}`}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <textarea
                  rows={4}
                  className="textarea textarea-bordered textarea-xs font-mono w-full focus:outline-none leading-relaxed"
                  placeholder={t.pastePlaceholder}
                  value={rawOpenApiInput}
                  onChange={(e) => setRawOpenApiInput(e.target.value)}
                />
              )}

              {openApiSpecJson && (
                <div className="flex flex-col gap-2.5 bg-base-300/20 p-3 rounded-xl border border-base-300/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-base-content/50 uppercase">{t.importTarget}</span>
                    <div className="flex bg-base-200 p-0.5 rounded-xl border border-base-300/40">
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all ${
                          openApiImportType === "component"
                            ? "bg-base-100 text-base-content shadow-sm"
                            : "text-base-content/60 hover:text-base-content"
                        }`}
                        onClick={() => setOpenApiImportType("component")}
                      >
                        {t.componentSchema}
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all ${
                          openApiImportType === "endpoint"
                            ? "bg-base-100 text-base-content shadow-sm"
                            : "text-base-content/60 hover:text-base-content"
                        }`}
                        onClick={() => setOpenApiImportType("endpoint")}
                      >
                        {t.endpointBody}
                      </button>
                    </div>
                  </div>

                  {openApiImportType === "component" ? (
                    availableOpenApiSchemas.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-bold text-base-content/40 uppercase">{t.selectSchema}</label>
                        <select
                          className="select select-bordered select-xs w-full text-xs font-mono font-semibold"
                          value={selectedOpenApiSchema}
                          onChange={(e) => setSelectedOpenApiSchema(e.target.value)}
                        >
                          {availableOpenApiSchemas.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-[10px] text-base-content/40 italic">{t.noSchemas}</span>
                    )
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {openApiEndpoints.length > 0 ? (
                        <>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-base-content/40 uppercase">
                              {t.selectEndpoint}
                            </label>
                            <select
                              className="select select-bordered select-xs w-full text-xs font-mono font-semibold"
                              value={selectedEndpointKey}
                              onChange={(e) => setSelectedEndpointKey(e.target.value)}
                            >
                              {openApiEndpoints.map((ep) => (
                                <option key={`${ep.method}:${ep.path}`} value={`${ep.method}:${ep.path}`}>
                                  {ep.method.toUpperCase()} {ep.path} {ep.summary ? `- ${ep.summary}` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-base-content/40 uppercase">{t.dataType}</label>
                            <div className="flex gap-3">
                              <label className="label cursor-pointer flex items-center gap-1.5 p-0">
                                <input
                                  type="radio"
                                  name="modal-openapi-io-unified"
                                  className="radio radio-primary radio-xs"
                                  checked={openApiIoType === "request"}
                                  onChange={() => setOpenApiIoType("request")}
                                />
                                <span className="text-[10px] font-semibold">{t.reqBody}</span>
                              </label>
                              <label className="label cursor-pointer flex items-center gap-1.5 p-0">
                                <input
                                  type="radio"
                                  name="modal-openapi-io-unified"
                                  className="radio radio-primary radio-xs"
                                  checked={openApiIoType === "response"}
                                  onChange={() => setOpenApiIoType("response")}
                                />
                                <span className="text-[10px] font-semibold">{t.resBody}</span>
                              </label>
                            </div>
                          </div>
                        </>
                      ) : (
                        <span className="text-[10px] text-base-content/40 italic">{t.noEndpoints}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-1.5 mt-1">
                <button
                  type="button"
                  className="btn btn-xs btn-primary font-bold"
                  disabled={openApiImportType === "component" ? !selectedOpenApiSchema : !selectedEndpointKey}
                  onClick={handleImportFromOpenApi}
                >
                  {t.importSchema}
                </button>
              </div>
            </div>
          )}

          {/* Tab Body 3: JSON Paste */}
          {activeImportTab === "json" && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[9px] font-bold text-base-content/50 uppercase">{t.jsonInputLabel}</span>
              <textarea
                rows={4}
                className="textarea textarea-bordered textarea-xs font-mono w-full focus:outline-none leading-relaxed"
                placeholder={t.jsonPlaceholder}
                value={rawJsonInput}
                onChange={(e) => setRawJsonInput(e.target.value)}
              />
              <div className="flex justify-end gap-1.5 mt-1">
                <button
                  type="button"
                  className="btn btn-xs btn-primary font-bold"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(rawJsonInput || "{}");
                      importFromJson(parsed);
                      setActiveImportTab(null);
                      setRawJsonInput("");
                    } catch (err) {
                      const message = err instanceof Error ? err.message : String(err);
                      toastError(`${t.jsonSyntaxError}: ${message}`);
                    }
                  }}
                >
                  {t.analyzeImport}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Properties Rows */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
        {orderedProperties.map((prop) => {
          const depth = getPropertyDepth(prop);
          const isObjectOrArray = prop.type === "object" || prop.type === "array";

          return (
            <div
              key={prop.id}
              className="grid grid-cols-12 gap-2 p-3 bg-base-200/40 rounded-2xl border border-base-300 items-center relative animate-fadeIn"
              style={{ marginLeft: `${depth * 1.5}rem` }}
            >
              {/* Visual Connection Guide for Nested Children */}
              {depth > 0 && (
                <div className="absolute left-0 top-0 bottom-0 flex items-center justify-center -ml-5 text-base-content/30 select-none pointer-events-none">
                  <CornerDownRight className="w-3.5 h-3.5" />
                </div>
              )}

              {/* Name (4.5 cols) */}
              <div className="col-span-4 flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  className="input input-bordered input-xs w-full text-xs focus:outline-none font-mono font-semibold"
                  placeholder={t.propertyNamePlaceholder}
                  value={prop.name}
                  onChange={(e) => updateProperty(prop.id, "name", e.target.value)}
                />
              </div>

              {/* Type & Sub-adder (3 cols) */}
              <div className="col-span-3 flex items-center gap-1">
                <select
                  className="select select-bordered select-xs w-full text-xs font-semibold focus:outline-none"
                  value={prop.type}
                  onChange={(e) => updateProperty(prop.id, "type", e.target.value)}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="integer">integer</option>
                  <option value="boolean">boolean</option>
                  <option value="object">object</option>
                  <option value="array">array</option>
                  <option value="ref">{t.refType}</option>
                </select>

                {isObjectOrArray && (
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => addSubProperty(prop.id)}
                      className="btn btn-primary btn-xs btn-square text-white"
                      title={t.addSubProperty}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs btn-square hover:bg-base-200"
                      disabled={!apiClientLastResponse}
                      onClick={() => apiClientLastResponse && importFromJson(apiClientLastResponse, prop.id)}
                      title={t.extractFromResponse}
                    >
                      <Globe className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Required (1.5 cols) */}
              <div className="col-span-2 flex items-center justify-center">
                <label className="label cursor-pointer flex items-center gap-1.5 p-0">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-xs rounded"
                    checked={prop.required}
                    onChange={(e) => updateProperty(prop.id, "required", e.target.checked)}
                  />
                  <span className="text-[10px] font-bold text-base-content/60">{t.required}</span>
                </label>
              </div>

              {/* Description (2 cols) */}
              <div className="col-span-2">
                <input
                  type="text"
                  className="input input-bordered input-xs w-full text-xs focus:outline-none"
                  placeholder={prop.type === "ref" ? "#/definitions/Category" : t.description}
                  value={prop.description}
                  onChange={(e) => updateProperty(prop.id, "description", e.target.value)}
                />
              </div>

              {/* Delete Button (1 col) */}
              <div className="col-span-1 flex justify-end">
                <button
                  onClick={() => removeProperty(prop.id)}
                  className="btn btn-ghost btn-xs text-error/70 hover:bg-error/15 p-0 w-6 h-6 rounded-circle"
                  title={t.deleteProperty}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        {properties.length === 0 && (
          <div className="text-center py-12 text-xs text-base-content/40 italic">{t.emptyProps}</div>
        )}
      </div>
    </div>
  );
}

// Recursive Draft-07 JSON Schema recursive compiler
export const generateJsonSchema = (title: string, description: string, properties: SchemaProperty[]): string => {
  const buildSchemaForNode = (
    props: SchemaProperty[],
    nodeId: string | undefined,
  ): { type: string; properties: Record<string, unknown>; required?: string[] } | null => {
    const children = props.filter((p) => p.parentId === nodeId);
    if (children.length === 0) {
      return null;
    }

    const propertiesObj: Record<string, unknown> = {};
    const requiredList: string[] = [];

    for (const child of children) {
      if (!child.name.trim()) {
        continue;
      }

      let childSchema: Record<string, unknown> = {};

      if (child.type === "ref") {
        childSchema = {
          $ref: child.description.trim() || "#",
        };
      } else {
        childSchema = {
          type: child.type,
          description: child.description.trim() || undefined,
        };

        if (child.type === "object") {
          const subProperties = buildSchemaForNode(props, child.id);
          if (subProperties) {
            childSchema = {
              ...childSchema,
              properties: subProperties.properties,
              required: subProperties.required,
            };
          } else {
            childSchema.properties = {};
          }
        } else if (child.type === "array") {
          const subProperties = buildSchemaForNode(props, child.id);
          const subChildren = props.filter((p) => p.parentId === child.id);

          if (subChildren.length === 1 && subChildren[0].type === "ref") {
            childSchema.items = {
              $ref: subChildren[0].description.trim() || "#",
            };
          } else if (subProperties && Object.keys(subProperties.properties || {}).length > 0) {
            childSchema.items = {
              type: "object",
              properties: subProperties.properties,
              required: subProperties.required,
            };
          } else {
            childSchema.items = { type: "string" };
          }
        }
      }

      propertiesObj[child.name.trim()] = childSchema;
      if (child.required) {
        requiredList.push(child.name.trim());
      }
    }

    const res: { type: string; properties: Record<string, unknown>; required?: string[] } = {
      type: "object",
      properties: propertiesObj,
    };

    if (requiredList.length > 0) {
      res.required = requiredList;
    }

    return res;
  };

  const rootSchema = buildSchemaForNode(properties, undefined);

  let definitionsObj: unknown;
  let defsObj: unknown;

  if (rootSchema?.properties) {
    if (rootSchema.properties.definitions) {
      const defs = rootSchema.properties.definitions as { properties?: Record<string, unknown> };
      definitionsObj = defs.properties;
      delete rootSchema.properties.definitions;
    }
    if (rootSchema.properties.$defs) {
      const defs = rootSchema.properties.$defs as { properties?: Record<string, unknown> };
      defsObj = defs.properties;
      delete rootSchema.properties.$defs;
    }
  }

  const schemaObj: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: title.trim() || undefined,
    description: description.trim() || undefined,
    type: "object",
    properties: rootSchema?.properties || {},
  };

  if (definitionsObj) {
    schemaObj.definitions = definitionsObj;
  }
  if (defsObj) {
    schemaObj.$defs = defsObj;
  }

  if (rootSchema?.required && rootSchema.required.length > 0) {
    schemaObj.required = rootSchema.required;
  }

  return JSON.stringify(schemaObj, null, 2);
};
