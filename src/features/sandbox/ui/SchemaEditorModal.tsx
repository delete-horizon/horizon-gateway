import { useAtom, useAtomValue } from "jotai";
import { Check, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { languageAtom } from "@/entities/app";
import { createJsonSchema, type SavedJsonSchema, savedJsonSchemasAtom, updateJsonSchema } from "@/entities/sandbox";
import { toastError } from "@/shared/ui/toast";
import { generateJsonSchema, SchemaPropertiesEditor, type SchemaProperty } from "./SchemaPropertiesEditor";

const en = {
  editTitle: "Edit JSON schema",
  newTitle: "New JSON schema",
  schemaTitle: "Schema title",
  titlePlaceholder: "e.g. UserPropsSchema",
  description: "Description",
  descriptionPlaceholder: "What this schema is for...",
  output: "Output (JSON Schema)",
  cancel: "Cancel",
  saved: "Saved",
  save: "Save",
};

const ko: typeof en = {
  editTitle: "JSON 스키마 편집",
  newTitle: "새 JSON 스키마",
  schemaTitle: "스키마 제목",
  titlePlaceholder: "예: UserPropsSchema",
  description: "설명",
  descriptionPlaceholder: "스키마 용도...",
  output: "출력 (JSON Schema)",
  cancel: "취소",
  saved: "저장됨",
  save: "저장",
};

interface SchemaEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  schemaId?: string; // If provided, we edit this schema; if undefined, we create a new one
  onSave?: (savedSchemaId: string) => void;
}

export function SchemaEditorModal({ isOpen, onClose, schemaId, onSave }: SchemaEditorModalProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const [savedSchemas, setSavedSchemas] = useAtom(savedJsonSchemasAtom);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [properties, setProperties] = useState<SchemaProperty[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  // Load existing schema if schemaId is passed
  useEffect(() => {
    if (isOpen) {
      if (schemaId) {
        const found = savedSchemas.find((s) => s.id === schemaId);
        if (found) {
          setTitle(found.name);
          setDescription(found.description);
          setProperties((found.properties as SchemaProperty[]) || []);
        }
      } else {
        // Reset to initial blank state for new schema creation
        setTitle("");
        setDescription("");
        setProperties([
          {
            id: Math.random().toString(36).substring(2, 9),
            name: "message",
            type: "string",
            description: "Default property",
            required: true,
          },
        ]);
      }
    }
  }, [isOpen, schemaId, savedSchemas]);

  // Generate JSON Schema Draft-07
  const generatedSchemaText = useMemo(() => {
    return generateJsonSchema(title, description, properties);
  }, [title, description, properties]);

  const handleSave = async () => {
    const targetTitle = title.trim() || "UntitledSchema";
    const targetDesc = description.trim();

    try {
      const savedRaw = schemaId
        ? await updateJsonSchema(schemaId, {
            name: targetTitle,
            description: targetDesc,
            properties,
            schemaText: generatedSchemaText,
          })
        : await createJsonSchema(targetTitle, targetDesc, properties, generatedSchemaText);

      if (!savedRaw) {
        throw new Error("Save failed");
      }

      const newSchemaEntry: SavedJsonSchema = {
        ...savedRaw,
        createdAt: savedRaw.createdAt ?? Date.now(),
        updatedAt: savedRaw.updatedAt ?? Date.now(),
      };

      if (schemaId) {
        setSavedSchemas(savedSchemas.map((s) => (s.id === schemaId ? newSchemaEntry : s)));
      } else {
        setSavedSchemas([...savedSchemas, newSchemaEntry]);
      }

      setJustSaved(true);
      setTimeout(() => {
        setJustSaved(false);
        if (onSave) {
          onSave(newSchemaEntry.id);
        }
        onClose();
      }, 800);
    } catch (e) {
      console.error(e);
      toastError("Failed to save schema.");
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[999] p-4 select-none animate-fadeIn">
      <div className="bg-base-100 rounded-3xl shadow-2xl border border-base-300 w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden animate-zoomIn">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-200 bg-base-200/40 shrink-0">
          <span className="font-bold text-sm text-base-content/85 flex items-center gap-1.5">
            {schemaId ? t.editTitle : t.newTitle}
          </span>
          <button onClick={onClose} className="btn btn-ghost btn-xs btn-circle text-base-content/50 hover:bg-base-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dual Panel Body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden items-stretch">
          {/* Left Panel: Properties Builder (8 cols) */}
          <div className="lg:col-span-8 p-6 overflow-y-auto flex flex-col gap-4 border-r border-base-200">
            {/* Meta details */}
            <div className="grid grid-cols-2 gap-4 shrink-0">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-base-content/50">{t.schemaTitle}</label>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full text-xs font-bold focus:outline-none"
                  placeholder={t.titlePlaceholder}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-base-content/50">{t.description}</label>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full text-xs focus:outline-none"
                  placeholder={t.descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* Properties Builder Component */}
            <div className="flex-1 overflow-y-auto min-h-[160px]">
              <SchemaPropertiesEditor properties={properties} onChange={setProperties} />
            </div>
          </div>

          {/* Right Panel: JSON Schema Preview (4 cols) */}
          <div className="lg:col-span-4 p-6 bg-base-200/30 flex flex-col overflow-hidden">
            <label className="text-[10px] font-medium text-base-content/50 mb-2 shrink-0">{t.output}</label>
            <div className="flex-1 bg-neutral rounded-2xl p-4 overflow-auto border border-neutral-content/10">
              <pre className="text-[10px] font-mono text-neutral-content leading-relaxed whitespace-pre-wrap">
                {generatedSchemaText}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-base-200 bg-base-200/40 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="btn btn-sm btn-ghost hover:bg-base-300">
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            className={`btn btn-sm btn-primary flex items-center gap-1 font-bold ${
              justSaved ? "btn-success text-white" : ""
            }`}
          >
            {justSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {justSaved ? t.saved : t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
