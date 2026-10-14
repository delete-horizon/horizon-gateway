import type { PipelineFlow, SavedPipeline } from "@/entities/pipeline";
import { commands, unwrap } from "@/shared/api";
import { readAppLang } from "@/shared/lib/i18n/app-lang";
import type { SavedJsonSchema } from "./store";
import type { CryptoAction, PipelineExecutionReport, SavedCryptoPreset, SchemaValidationResult } from "./types";

export async function processCrypto(action: CryptoAction, payload: string, key?: string, iv?: string): Promise<string> {
  if (action === "custom") {
    throw new Error(
      readAppLang() === "ko"
        ? "커스텀 JS 스크립트는 백엔드에서 실행할 수 없습니다."
        : "Custom JS scripts cannot run on the backend.",
    );
  }
  const res = unwrap(
    await commands.processCrypto({
      action: action as Exclude<CryptoAction, "custom">,
      payload,
      key: key || null,
      iv: iv || null,
    }),
  );
  if (!res.success) {
    throw new Error(res.message);
  }
  return res.data;
}

export async function validateJsonSchema(payload: string, schema: string): Promise<SchemaValidationResult> {
  const res = unwrap(
    await commands.validateJsonSchema({
      payload,
      schema,
    }),
  );
  if (res.data) {
    return res.data;
  }
  throw new Error(res.message);
}

export async function executePipeline(flow: PipelineFlow): Promise<PipelineExecutionReport> {
  const res = unwrap(await commands.executePipeline(flow));
  if (!res.success) {
    throw new Error(res.message);
  }
  return res.data;
}

export async function executePipelineApiNode(config: unknown): Promise<unknown> {
  const configJson = JSON.stringify(config);
  const res = unwrap(await commands.executePipelineApiNode(configJson));
  if (!res.success) {
    throw new Error(res.message);
  }
  return JSON.parse(res.data) as unknown;
}

// --- Pipeline library ---

export async function getSavedPipelines(): Promise<SavedPipeline[]> {
  const res = unwrap(await commands.getSavedPipelines());
  return (res.data ?? []) as SavedPipeline[];
}

export async function createSavedPipeline(
  name: string,
  description: string,
  flow: PipelineFlow,
): Promise<SavedPipeline> {
  const res = unwrap(await commands.createSavedPipeline({ name, description, flow }));
  return res.data as SavedPipeline;
}

export async function updateSavedPipeline(
  id: string,
  patch: { name?: string; description?: string; flow?: PipelineFlow },
): Promise<SavedPipeline | null> {
  const res = unwrap(
    await commands.updateSavedPipeline({
      id,
      name: patch.name ?? null,
      description: patch.description ?? null,
      flow: patch.flow ?? null,
    }),
  );
  return res.data as SavedPipeline | null;
}

export async function deleteSavedPipeline(id: string): Promise<boolean> {
  const res = unwrap(await commands.deleteSavedPipeline({ id }));
  return res.data;
}

export async function importSavedPipelines(pipelines: SavedPipeline[]): Promise<SavedPipeline[]> {
  const res = unwrap(await commands.importSavedPipelines({ pipelines }));
  return (res.data ?? []) as SavedPipeline[];
}

// --- JSON Schema registry ---

export async function getJsonSchemas(): Promise<SavedJsonSchema[]> {
  const res = unwrap(await commands.getJsonSchemas());
  return (res.data ?? []) as SavedJsonSchema[];
}

export async function createJsonSchema(
  name: string,
  description: string,
  properties: SavedJsonSchema["properties"],
  schemaText: string,
): Promise<SavedJsonSchema> {
  const res = unwrap(
    await commands.createJsonSchema({
      name,
      description,
      properties,
      schemaText,
    }),
  );
  return res.data as SavedJsonSchema;
}

export async function updateJsonSchema(
  id: string,
  patch: Partial<Pick<SavedJsonSchema, "name" | "description" | "properties" | "schemaText">>,
): Promise<SavedJsonSchema | null> {
  const res = unwrap(
    await commands.updateJsonSchema({
      id,
      name: patch.name ?? null,
      description: patch.description ?? null,
      properties: patch.properties ?? null,
      schemaText: patch.schemaText ?? null,
    }),
  );
  return res.data as SavedJsonSchema | null;
}

export async function deleteJsonSchema(id: string): Promise<boolean> {
  const res = unwrap(await commands.deleteJsonSchema({ id }));
  return res.data;
}

export async function importJsonSchemas(schemas: SavedJsonSchema[]): Promise<SavedJsonSchema[]> {
  const res = unwrap(await commands.importJsonSchemas({ schemas }));
  return (res.data ?? []) as SavedJsonSchema[];
}

// --- Crypto presets ---

export async function getCryptoPresets(): Promise<SavedCryptoPreset[]> {
  const res = unwrap(await commands.getCryptoPresets());
  return (res.data ?? []) as SavedCryptoPreset[];
}

export async function createCryptoPreset(
  preset: Omit<SavedCryptoPreset, "id" | "createdAt" | "updatedAt">,
): Promise<SavedCryptoPreset> {
  const res = unwrap(
    await commands.createCryptoPreset({
      name: preset.name,
      description: preset.description,
      action: preset.action,
      payload: preset.payload,
      key: preset.key,
      iv: preset.iv,
      code: preset.code ?? null,
    }),
  );
  return res.data as SavedCryptoPreset;
}

export async function updateCryptoPreset(
  id: string,
  patch: Partial<Omit<SavedCryptoPreset, "id" | "createdAt" | "updatedAt">>,
): Promise<SavedCryptoPreset | null> {
  const payload: {
    id: string;
    name: string | null;
    description: string | null;
    action: string | null;
    payload: string | null;
    key: string | null;
    iv: string | null;
    code?: string | null;
  } = {
    id,
    name: patch.name ?? null,
    description: patch.description ?? null,
    action: patch.action ?? null,
    payload: patch.payload ?? null,
    key: patch.key ?? null,
    iv: patch.iv ?? null,
  };
  if (patch.code !== undefined) {
    payload.code = patch.code ?? null;
  }
  const res = unwrap(await commands.updateCryptoPreset(payload));
  return res.data as SavedCryptoPreset | null;
}

export async function deleteCryptoPreset(id: string): Promise<boolean> {
  const res = unwrap(await commands.deleteCryptoPreset({ id }));
  return res.data;
}

export async function importCryptoPresets(presets: SavedCryptoPreset[]): Promise<SavedCryptoPreset[]> {
  const res = unwrap(await commands.importCryptoPresets({ presets }));
  return (res.data ?? []) as SavedCryptoPreset[];
}

const LS_PIPELINES = "horizon-gateway-saved-pipelines";
const LS_SCHEMAS = "horizon-gateway-saved-json-schemas";
const LS_CRYPTO = "horizon-gateway-saved-crypto-presets";
const MIGRATED_FLAG = "horizon-gateway-sandbox-library-migrated-v1";

function readLocalStorageJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** One-shot: localStorage → app_data when Rust store is empty. */
export async function migrateSandboxLibrariesFromLocalStorage(): Promise<{
  pipelines: SavedPipeline[];
  schemas: SavedJsonSchema[];
  presets: SavedCryptoPreset[];
}> {
  let pipelines = await getSavedPipelines();
  let schemas = await getJsonSchemas();
  let presets = await getCryptoPresets();

  if (localStorage.getItem(MIGRATED_FLAG) !== "1") {
    if (pipelines.length === 0) {
      const ls = readLocalStorageJson<SavedPipeline[]>(LS_PIPELINES);
      if (ls && ls.length > 0) {
        pipelines = await importSavedPipelines(ls);
      }
    }
    if (schemas.length === 0) {
      const ls = readLocalStorageJson<SavedJsonSchema[]>(LS_SCHEMAS);
      if (ls && ls.length > 0) {
        schemas = await importJsonSchemas(ls);
      }
    }
    if (presets.length === 0) {
      const ls = readLocalStorageJson<SavedCryptoPreset[]>(LS_CRYPTO);
      if (ls && ls.length > 0) {
        presets = await importCryptoPresets(ls);
      }
    }
    localStorage.setItem(MIGRATED_FLAG, "1");
  }

  return { pipelines, schemas, presets };
}
