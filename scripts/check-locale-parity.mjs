/**
 * Fail when a Korean locale object and its English pair do not have the same keys.
 *
 * Pairs:
 * - same file: `en`/`ko`, or names ending in `En`/`Ko` (`windowBehaviorEn`)
 * - sibling files: `en.ts`/`ko.ts`, `*-en.ts`/`*-ko.ts`, `*.en.ts`/`*.ko.ts`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(ent.name) && !ent.name.endsWith(".gen.ts") && ent.name !== "bindings.ts") {
      out.push(full);
    }
  }
}

function unwrap(expr) {
  let current = expr;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function keysOf(node, prefix, rel, errors) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys = [];
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop) || (prop.name && ts.isComputedPropertyName(prop.name))) {
      errors.push(`${rel}: locale object uses spread or computed keys; parity check cannot see them`);
      return null;
    }
    if (!ts.isPropertyAssignment(prop) && !ts.isMethodDeclaration(prop) && !ts.isShorthandPropertyAssignment(prop)) {
      errors.push(`${rel}: unsupported locale property`);
      return null;
    }
    const name = ts.isShorthandPropertyAssignment(prop) ? prop.name.text : propName(prop.name);
    if (!name) {
      errors.push(`${rel}: locale property has no static name`);
      return null;
    }
    const full = prefix ? `${prefix}.${name}` : name;
    if (ts.isPropertyAssignment(prop)) {
      const init = unwrap(prop.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        const nested = keysOf(init, full, rel, errors);
        if (!nested) return null;
        keys.push(...nested);
        continue;
      }
    }
    keys.push(full);
  }
  return keys;
}

function localeRole(name) {
  if (name === "en" || name === "ko") return { role: name, stem: "" };
  if (name.endsWith("En") && name.length > 2) return { role: "en", stem: name.slice(0, -2) };
  if (name.endsWith("Ko") && name.length > 2) return { role: "ko", stem: name.slice(0, -2) };
  return null;
}

function fileGroup(filePath) {
  const base = path.basename(filePath);
  const dir = path.dirname(filePath);
  if (/^(en|ko)\.tsx?$/.test(base)) return `${dir}::pair`;
  const split = base.match(/^(.*?)(?:-en|-ko|\.en|\.ko)\.tsx?$/);
  if (split) return `${path.join(dir, split[1])}::pair`;
  return `${filePath}::same`;
}

const files = [];
walk(SRC, files);

const errors = [];
/** @type {Map<string, { en?: { rel: string, keys: string[] }, ko?: { rel: string, keys: string[] } }>} */
const pairs = new Map();

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file);

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const role = localeRole(node.name.text);
      const init = unwrap(node.initializer);
      if (role && ts.isObjectLiteralExpression(init)) {
        const keys = keysOf(init, "", rel, errors);
        if (keys) {
          const id = `${fileGroup(file)}|${role.stem}`;
          const slot = pairs.get(id) ?? {};
          if (slot[role.role]) {
            errors.push(`${rel}: duplicate ${role.role} locale object for ${id}`);
          } else {
            slot[role.role] = { rel, keys };
            pairs.set(id, slot);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const pairIds = [...pairs.keys()].sort();
if (pairIds.length === 0) {
  errors.push("no locale pairs found");
}

for (const id of pairIds) {
  const pair = pairs.get(id);
  if (!pair.en || !pair.ko) {
    const present = pair.en?.rel ?? pair.ko?.rel;
    errors.push(`${present}: locale pair is missing ${pair.en ? "ko" : "en"} (${id})`);
    continue;
  }
  const enKeys = new Set(pair.en.keys);
  const koKeys = new Set(pair.ko.keys);
  const missingKo = [...enKeys].filter((key) => !koKeys.has(key)).sort();
  const missingEn = [...koKeys].filter((key) => !enKeys.has(key)).sort();
  if (missingKo.length || missingEn.length) {
    errors.push(
      `${pair.en.rel} ↔ ${pair.ko.rel}: ${missingKo.length ? `missing in ko: ${missingKo.join(", ")}` : ""}${
        missingKo.length && missingEn.length ? "; " : ""
      }${missingEn.length ? `missing in en: ${missingEn.join(", ")}` : ""}`,
    );
  }
}

if (errors.length) {
  for (const message of errors) console.error(`locale-parity: ${message}`);
  process.exit(1);
}

console.log(`locale-parity: ok (${pairIds.length} pairs)`);
