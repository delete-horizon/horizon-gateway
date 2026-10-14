import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SavedComponent, SavedCryptoPreset } from "./types";

export interface ApiClientHistoryItem {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
}

export interface ApiRequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface CryptoConfig {
  action: string;
  key: string;
  iv: string;
  code?: string;
}

// Stores historical API requests sent via API Client
export const apiClientHistoryAtom = atomWithStorage<ApiClientHistoryItem[]>("horizon-gateway-api-client-history", []);

// Stores autocomplete header suggestions (initially standard ones, updated when users add new)
export {
  autocompleteBodiesAtom,
  autocompleteHeadersAtom,
  autocompleteHeaderValuesAtom as autocompleteValuesAtom,
  autocompleteHeaderValuesAtom,
  autocompleteOriginsAtom,
  autocompleteParamValuesAtom,
  autocompletePathnamesAtom,
  autocompletePathnamesByOriginAtom,
} from "@/entities/api-request";

// Stores pipeline → preview handoff data
export const livePreviewDataAtom = atom<unknown | null>(null);

// Stores dynamic component TSX source code for live preview
export const livePreviewCodeAtom = atomWithStorage<string>(
  "horizon-gateway-live-preview-code",
  `import React from 'react';

export default function Preview({ data }: Props) {
  // Try sending a request in the pipeline or API client
  // And map the response here!
  const displayData = data || {
    title: "Welcome to Horizon Gateway Sandbox",
    message: "Connect an API node or pipeline output to bind dynamic props.",
    items: ["Base64 Encoding", "AES-256-GCM Encryption", "Promise Pipelines"]
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-base-100 rounded-xl shadow-lg border border-base-300">
      <div className="flex items-center space-x-4">
        <div>
          <div className="text-xl font-medium text-primary">{displayData.title || "Untitled"}</div>
          <p className="text-base-content/70 text-sm mt-1">{displayData.message}</p>
        </div>
      </div>
      {displayData.items && (
        <ul className="mt-4 space-y-1 text-xs text-base-content/80 list-disc list-inside">
          {displayData.items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}`,
);

// One-shot prefill payload when navigating from schema → client
export const apiClientPrefillAtom = atom<ApiRequestConfig | null>(null);

// Shared atoms for visual pipeline and utility pages importing configs
export const apiClientCurrentRequestAtom = atom<ApiRequestConfig>({
  method: "GET",
  url: "https://api.example.com/todos/1",
  headers: { Accept: "application/json" },
  body: "",
});

export const schemaBuilderCurrentSchemaAtom = atom<string>("");

export const cryptoToolCurrentConfigAtom = atom<CryptoConfig>({
  action: "base64Encode",
  key: "",
  iv: "",
  code: "",
});

export const apiClientLastResponseAtom = atom<unknown>(null);

export interface SavedJsonSchema {
  id: string;
  name: string;
  description: string;
  properties: Array<{
    id: string;
    name: string;
    type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "ref";
    description: string;
    required: boolean;
    parentId?: string;
  }>;
  schemaText: string;
  createdAt: number;
  updatedAt: number;
}

export const savedJsonSchemasAtom = atomWithStorage<SavedJsonSchema[]>("horizon-gateway-saved-json-schemas", [
  {
    id: "default-user-payload",
    name: "UserPayload",
    description: "User registration payload schema",
    properties: [
      { id: "1", name: "id", type: "integer", description: "The unique identifier of the user", required: true },
      { id: "2", name: "username", type: "string", description: "User's login name", required: true },
      { id: "3", name: "email", type: "string", description: "Primary contact email", required: false },
      {
        id: "4",
        name: "isActive",
        type: "boolean",
        description: "Whether the user account is active",
        required: false,
      },
    ],
    schemaText: `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "UserPayload",
  "description": "User registration payload schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "integer",
      "description": "The unique identifier of the user"
    },
    "username": {
      "type": "string",
      "description": "User's login name"
    },
    "email": {
      "type": "string",
      "description": "Primary contact email"
    },
    "isActive": {
      "type": "boolean",
      "description": "Whether the user account is active"
    }
  },
  "required": [
    "id",
    "username"
  ]
}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]);

export const savedComponentsAtom = atomWithStorage<SavedComponent[]>("horizon-gateway-saved-components", [
  {
    id: "welcome-card",
    name: "WelcomeCard",
    description: "Default welcome card for Horizon Gateway Sandbox",
    code: `import React from 'react';

export default function Preview({ title, message, items }: Props) {
  // Try sending a request in the pipeline or API client
  // And map the response here!
  const displayTitle = title || "Welcome to Horizon Gateway Sandbox";
  const displayMessage = message || "Connect an API node or pipeline output to bind dynamic props.";
  const displayItems = items || ["Base64 Encoding", "AES-256-GCM Encryption", "Promise Pipelines"];

  return (
    <div className="p-6 max-w-md mx-auto bg-base-100 rounded-xl shadow-lg border border-base-300">
      <div className="flex items-center space-x-4">
        <div>
          <div className="text-xl font-medium text-primary">{displayTitle}</div>
          <p className="text-base-content/70 text-sm mt-1">{displayMessage}</p>
        </div>
      </div>
      {displayItems && (
        <ul className="mt-4 space-y-1 text-xs text-base-content/80 list-disc list-inside">
          {displayItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}`,
    mockData: `{
  "title": "Welcome to Horizon Gateway Sandbox",
  "message": "Connect an API node or pipeline output to bind dynamic props.",
  "items": [
    "Base64 Encoding",
    "AES-256-GCM Encryption",
    "Promise Pipelines"
  ]
}`,
    createdAt: 1719500000000,
    updatedAt: 1719500000000,
    schemaId: undefined,
  },
]);

export const selectedComponentIdAtom = atomWithStorage<string>("horizon-gateway-selected-component-id", "welcome-card");

export const savedCryptoPresetsAtom = atomWithStorage<SavedCryptoPreset[]>("horizon-gateway-saved-crypto-presets", [
  {
    id: "default-base64-encode",
    name: "Base64 Encode Default",
    description: "Standard Base64 encoding preset",
    action: "base64Encode",
    payload: "Hello, Horizon Gateway!",
    key: "",
    iv: "",
    createdAt: 1719500000000,
    updatedAt: 1719500000000,
  },
  {
    id: "default-aes-encrypt",
    name: "AES Encrypt Default",
    description: "AES-256-GCM symmetric encryption preset",
    action: "aesEncrypt",
    payload: "Secret message here",
    key: "my-secret-key-must-be-32-bytes-long",
    iv: "my-custom-iv-12",
    createdAt: 1719500000000,
    updatedAt: 1719500000000,
  },
  {
    id: "default-sha256",
    name: "SHA-256 Hash Default",
    description: "SHA-256 cryptographic hash preset",
    action: "sha256",
    payload: "Input payload to hash",
    key: "",
    iv: "",
    createdAt: 1719500000000,
    updatedAt: 1719500000000,
  },
]);
