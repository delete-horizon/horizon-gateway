import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, Copy, Download, FileCode, Layers, Plus, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { languageAtom } from "@/entities/app";
import {
  createJsonSchema,
  deleteJsonSchema,
  type SavedJsonSchema,
  savedJsonSchemasAtom,
  schemaBuilderCurrentSchemaAtom,
  updateJsonSchema,
} from "@/entities/sandbox";
import { hubJsonSchemaSeedAtom } from "@/features/panel-stack";
import { generateJsonSchema, SchemaPropertiesEditor, type SchemaProperty } from "@/features/sandbox";
import { useIsEmbeddedPage } from "@/shared/lib/tauri/useEmbedMode";
import { toastError } from "@/shared/ui/toast";

export const Route = createFileRoute("/apis/json-schema/")({
  component: JsonSchemaPage,
});

const en = {
  title: "JSON Schema Registry",
  subtitle:
    "Define, build, and save JSON Schemas (Draft-07) to validate API payloads and use in visual pipeline nodes.",
  addSchema: "Add New Schema",
  schemaList: "Saved Schemas",
  searchSchemas: "Search schemas...",
  noSchemas: "No saved schemas found. Click Add New Schema to start.",
  schemaTitle: "Schema Title",
  schemaDesc: "Schema Description",
  save: "Save Schema",
  saved: "Saved!",
  copy: "Copy Schema",
  copied: "Copied!",
  download: "Download JSON",
  deleteConfirm: "Are you sure you want to delete this schema?",
  validationResult: "Output Result (JSON Schema)",
  details: "Schema details",
  modified: "Modified",
};

const ko = {
  title: "JSON 스키마 저장소",
  subtitle:
    "JSON 스키마(Draft-07)를 작성, 저장하고 API 검증 및 데이터 파이프라인 노드 등 여러 기능에서 불러와 사용합니다.",
  addSchema: "새 스키마 추가",
  schemaList: "저장된 스키마",
  searchSchemas: "스키마 검색...",
  noSchemas: "저장된 스키마가 없습니다. 새 스키마 추가를 클릭하세요.",
  schemaTitle: "스키마 제목",
  schemaDesc: "스키마 설명",
  save: "스키마 저장",
  saved: "저장됨",
  copy: "스키마 복사",
  copied: "복사됨",
  download: "다운로드",
  deleteConfirm: "이 스키마를 삭제하시겠습니까?",
  validationResult: "출력 결과 (JSON Schema)",
  details: "스키마 상세",
  modified: "변경됨",
};

function JsonSchemaPage() {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const isKo = lang === "ko";
  const isEmbedded = useIsEmbeddedPage();

  const [savedSchemas, setSavedSchemas] = useAtom(savedJsonSchemasAtom);
  const setSharedSchema = useSetAtom(schemaBuilderCurrentSchemaAtom);
  const [jsonSchemaSeed, setJsonSchemaSeed] = useAtom(hubJsonSchemaSeedAtom);

  const [selectedId, setSelectedId] = useState<string>(() => {
    return savedSchemas.length > 0 ? savedSchemas[0].id : "";
  });

  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [properties, setProperties] = useState<SchemaProperty[]>([]);
  const [copied, setCopied] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Load selected schema
  useEffect(() => {
    const found = savedSchemas.find((s) => s.id === selectedId);
    if (found) {
      setTitle(found.name);
      setDescription(found.description);
      setProperties(found.properties as SchemaProperty[]);
    } else if (savedSchemas.length > 0) {
      setSelectedId(savedSchemas[0].id);
    } else {
      setTitle("");
      setDescription("");
      setProperties([]);
    }
  }, [selectedId, savedSchemas]);

  useEffect(() => {
    if (!jsonSchemaSeed) {
      return;
    }

    const schemaText = generateJsonSchema(jsonSchemaSeed.title, jsonSchemaSeed.description, jsonSchemaSeed.properties);
    void (async () => {
      try {
        const created = await createJsonSchema(
          jsonSchemaSeed.title,
          jsonSchemaSeed.description,
          jsonSchemaSeed.properties,
          schemaText,
        );
        const newSchema: SavedJsonSchema = {
          ...created,
          createdAt: created.createdAt ?? Date.now(),
          updatedAt: created.updatedAt ?? Date.now(),
        };
        setSavedSchemas((prev) => [newSchema, ...prev]);
        setSelectedId(newSchema.id);
        setTitle(newSchema.name);
        setDescription(newSchema.description);
        setProperties(newSchema.properties as SchemaProperty[]);
      } catch (e) {
        console.error(e);
      } finally {
        setJsonSchemaSeed(null);
      }
    })();
  }, [jsonSchemaSeed, setJsonSchemaSeed, setSavedSchemas]);

  // Search filter
  const filteredSchemas = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) {
      return savedSchemas;
    }
    return savedSchemas.filter(
      (s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query),
    );
  }, [savedSchemas, search]);

  // Generate Draft-07 Schema recursively
  const generatedSchema = useMemo(() => {
    return generateJsonSchema(title, description, properties);
  }, [title, description, properties]);

  // Sync to shared schema for pipeline nodes
  useEffect(() => {
    setSharedSchema(generatedSchema);
  }, [generatedSchema, setSharedSchema]);

  // Has unsaved changes check
  const hasUnsavedChanges = useMemo(() => {
    const found = savedSchemas.find((s) => s.id === selectedId);
    if (!found) {
      return false;
    }

    return (
      found.name !== title ||
      found.description !== description ||
      JSON.stringify(found.properties) !== JSON.stringify(properties)
    );
  }, [selectedId, savedSchemas, title, description, properties]);

  // CRUD Operations
  const handleAddSchema = async () => {
    const propertiesSeed: SchemaProperty[] = [
      {
        id: "1",
        name: "id",
        type: "integer",
        description: "The identifier",
        required: true,
      },
    ];
    const schemaText = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "NewSchema",
  "description": "A newly created JSON Schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "integer",
      "description": "The identifier"
    }
  },
  "required": [
    "id"
  ]
}`;
    try {
      const created = await createJsonSchema("NewSchema", "A newly created JSON Schema", propertiesSeed, schemaText);
      const normalized: SavedJsonSchema = {
        ...created,
        createdAt: created.createdAt ?? Date.now(),
        updatedAt: created.updatedAt ?? Date.now(),
      };
      setSavedSchemas([...savedSchemas, normalized]);
      setSelectedId(normalized.id);
    } catch (e) {
      console.error(e);
      toastError(isKo ? "스키마 추가에 실패했습니다." : "Failed to add schema.");
    }
  };

  const handleSave = async () => {
    try {
      const updatedItem = await updateJsonSchema(selectedId, {
        name: title,
        description,
        properties,
        schemaText: generatedSchema,
      });
      if (!updatedItem) {
        throw new Error("Not found");
      }
      const normalized: SavedJsonSchema = {
        ...updatedItem,
        createdAt: updatedItem.createdAt ?? Date.now(),
        updatedAt: updatedItem.updatedAt ?? Date.now(),
      };
      setSavedSchemas(savedSchemas.map((s) => (s.id === selectedId ? normalized : s)));
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      console.error(e);
      toastError(isKo ? "저장에 실패했습니다." : "Failed to save schema.");
    }
  };

  const handleDeleteSchema = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(t.deleteConfirm)) {
      return;
    }
    try {
      await deleteJsonSchema(id);
      const remaining = savedSchemas.filter((s) => s.id !== id);
      setSavedSchemas(remaining);
      if (selectedId === id) {
        if (remaining.length > 0) {
          setSelectedId(remaining[0].id);
        } else {
          setSelectedId("");
        }
      }
    } catch (err) {
      console.error(err);
      toastError(isKo ? "삭제에 실패했습니다." : "Failed to delete schema.");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedSchema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([generatedSchema], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase() || "schema"}.schema.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`flex flex-col space-y-6 w-full overflow-hidden ${isEmbedded ? "h-full min-h-0" : "h-[calc(100vh-10rem)]"}`}
    >
      {!isEmbedded && (
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileCode className="text-primary w-6 h-6" /> {t.title}
            </h1>
            <p className="text-sm text-base-content/70 mt-1">{t.subtitle}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-stretch flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Schema List */}
        <div className="xl:col-span-1 card bg-base-100 border border-base-300 p-4 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between border-b border-base-200 pb-3 mb-3 shrink-0">
            <span className="font-semibold flex items-center gap-1.5 text-base-content/85">
              <Layers className="w-4 h-4 text-primary" /> {t.schemaList} ({savedSchemas.length})
            </span>
            <button onClick={handleAddSchema} className="btn btn-xs btn-primary flex items-center gap-1">
              <Plus className="w-3 h-3" /> {t.addSchema}
            </button>
          </div>

          <div className="relative group/sch shrink-0 mb-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30" />
            <input
              type="text"
              className="input input-bordered input-xs pl-8 w-full text-xs font-semibold focus:outline-none"
              placeholder={t.searchSchemas}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredSchemas.length === 0 ? (
              <div className="text-center py-10 text-xs text-base-content/40 italic">{t.noSchemas}</div>
            ) : (
              filteredSchemas.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`p-3 border rounded-xl cursor-pointer transition-all duration-200 flex items-center justify-between group ${
                    selectedId === s.id
                      ? "bg-primary/10 border-primary/45 shadow-sm"
                      : "border-base-200 hover:border-primary/40 hover:bg-base-200/50"
                  }`}
                >
                  <div className="flex flex-col space-y-1 min-w-0 pr-2">
                    <span className="font-bold text-xs truncate text-base-content/85">{s.name}</span>
                    <span className="text-[10px] text-base-content/50 truncate">
                      {s.description || "No description"}
                    </span>
                  </div>
                  <button
                    className="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleDeleteSchema(s.id, e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Main Visual Editor */}
        <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch h-full overflow-hidden">
          {selectedId ? (
            <>
              {/* Visual Grid Form */}
              <div className="lg:col-span-7 card bg-base-100 border border-base-300 p-5 shadow-sm flex flex-col h-full overflow-hidden">
                {/* Save Status & Action Header */}
                <div className="flex justify-between items-center pb-3 border-b border-base-200 mb-4 shrink-0">
                  <h3 className="font-bold text-sm text-primary flex items-center gap-1.5">⚙️ {title || t.details}</h3>
                  <div className="flex items-center gap-3">
                    {hasUnsavedChanges && (
                      <span className="badge badge-warning badge-xs font-bold text-[10px] py-1.5 px-2">
                        {t.modified}
                      </span>
                    )}
                    <button
                      onClick={handleSave}
                      className={`btn btn-xs ${justSaved ? "btn-success" : "btn-primary"} flex items-center gap-1 font-bold`}
                    >
                      <Save className="w-3.5 h-3.5" /> {justSaved ? t.saved : t.save}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-5 pr-1 no-scrollbar flex flex-col min-h-0">
                  {/* Schema Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
                    <div className="flex flex-col gap-1">
                      <label className="label-text text-xs font-semibold text-base-content/70">{t.schemaTitle}</label>
                      <input
                        type="text"
                        className="input input-bordered input-sm font-semibold focus:outline-none"
                        placeholder={t.schemaTitle}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label-text text-xs font-semibold text-base-content/70">{t.schemaDesc}</label>
                      <input
                        type="text"
                        className="input input-bordered input-sm focus:outline-none"
                        placeholder={t.schemaDesc}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Properties Builder Component */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <SchemaPropertiesEditor properties={properties} onChange={setProperties} />
                  </div>
                </div>
              </div>

              {/* JSON Spec View */}
              <div className="lg:col-span-5 card bg-base-100 border border-base-300 p-5 shadow-sm flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between border-b border-base-200 pb-3 mb-4 shrink-0">
                  <span className="font-semibold text-sm text-base-content/85">{t.validationResult}</span>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-xs btn-outline btn-ghost flex items-center gap-1"
                      onClick={handleDownload}
                    >
                      <Download className="w-3 h-3" /> {t.download}
                    </button>
                    <button
                      className={`btn btn-xs ${copied ? "btn-success" : "btn-outline btn-ghost"} flex items-center gap-1`}
                      onClick={handleCopy}
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? t.copied : t.copy}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto bg-base-200 border border-base-300 rounded-lg p-4 font-mono text-[11px] leading-relaxed no-scrollbar flex flex-col min-h-0">
                  <textarea
                    className="flex-1 w-full bg-transparent resize-none border-none outline-none focus:outline-none focus:ring-0 text-success p-0 font-mono text-[11px] leading-relaxed"
                    value={generatedSchema}
                    readOnly
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="col-span-12 flex items-center justify-center bg-base-100 border border-base-300 rounded-xl p-12 text-sm text-base-content/40 italic">
              {t.noSchemas}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
