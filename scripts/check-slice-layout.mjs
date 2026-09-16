/**
 * Slice folder shape for src/entities/* and src/features/*.
 * Import direction is Biome (biome.json). This script only checks folders.
 *
 * Unchanging:
 * - each slice is a directory with index.ts or index.tsx
 * - inner directories are only hooks | lib | ui | i18n
 *
 * EXTRA_DIR_ALLOW may shrink, never grow, unless the user explicitly asks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LAYERS = ["entities", "features"];
const ALLOWED_DIRS = new Set(["hooks", "lib", "ui", "i18n"]);

/** Frozen extras. Remove entries as those folders migrate; do not add keys. */
const EXTRA_DIR_ALLOW = {
  "entities/app": ["status", "telemetry", "theme", "user", "window-behavior"],
  "entities/chat": ["api"],
  "entities/team": ["model"],
};

function entries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
}

function fail(messages) {
  for (const m of messages) console.error(`slice-layout: ${m}`);
  process.exit(1);
}

const errors = [];

for (const layer of LAYERS) {
  const layerDir = path.join(SRC, layer);
  if (!fs.existsSync(layerDir)) {
    errors.push(`missing ${path.relative(ROOT, layerDir)}`);
    continue;
  }

  for (const ent of entries(layerDir)) {
    const rel = `${layer}/${ent.name}`;
    if (!ent.isDirectory()) {
      errors.push(`${rel} must be a slice directory, not a file`);
      continue;
    }

    const sliceDir = path.join(layerDir, ent.name);
    const kids = entries(sliceDir);
    const files = kids.filter((e) => e.isFile()).map((e) => e.name);
    const dirs = kids.filter((e) => e.isDirectory()).map((e) => e.name);
    const allowed = new Set([...ALLOWED_DIRS, ...(EXTRA_DIR_ALLOW[rel] ?? [])]);

    if (!files.includes("index.ts") && !files.includes("index.tsx")) {
      errors.push(`${rel} needs index.ts (or index.tsx) barrel`);
    }

    for (const d of dirs) {
      if (!allowed.has(d)) {
        errors.push(`${rel} has folder "${d}" — allowed: ${[...ALLOWED_DIRS].join(", ")}`);
      }
    }
  }
}

if (errors.length) fail(errors);
console.log("slice-layout: ok");
