#!/usr/bin/env node
/**
 * Copy the hgc binary produced by the release build into a staging directory.
 * Windows copies are named hgc.exe. Other copies are named hgc.
 *
 *   node scripts/stage-hgc-for-mcpb.mjs mcpb-staging
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hostTriple() {
  const result = spawnSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function walk(dir, found) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "deps" || entry.name === "incremental" || entry.name === "build") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
      continue;
    }
    if (/^hgc(-.+)?(\.exe)?$/.test(entry.name)) {
      found.push(full);
    }
  }
}

function score(filePath, triple) {
  const normalized = filePath.split(sep).join("/");
  let value = 0;
  if (normalized.includes("/binaries/")) {
    value += 50;
  }
  if (normalized.includes("/release/")) {
    value += 20;
  }
  if (normalized.includes("/debug/")) {
    value -= 20;
  }
  if (triple && normalized.includes(triple)) {
    value += 10;
  }
  return value;
}

function main() {
  const destDir = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) {
    fail("usage: node scripts/stage-hgc-for-mcpb.mjs <dest-dir>");
  }
  const roots = ["src-tauri/hg-gui/binaries", "src-tauri/target"];
  const found = [];
  for (const root of roots) {
    walk(resolve(root), found);
  }
  if (found.length === 0) {
    fail("no hgc binary found under src-tauri/hg-gui/binaries or src-tauri/target");
  }
  const triple = hostTriple();
  const ranked = found
    .map((filePath) => ({ filePath, score: score(filePath, triple) }))
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
  const best = ranked[0];
  const ties = ranked.filter((item) => item.score === best.score);
  if (ties.length > 1) {
    fail(`more than one hgc candidate at the same rank:\n${ties.map((item) => item.filePath).join("\n")}`);
  }
  const name = best.filePath.endsWith(".exe") ? "hgc.exe" : "hgc";
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name);
  copyFileSync(best.filePath, dest);
  const size = statSync(dest).size;
  console.log(`staged ${best.filePath} -> ${dest} (${size} bytes)`);
}

main();
