#!/usr/bin/env node
/**
 * Fail if git tag / expected version does not match package.json,
 * src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
 *
 * Usage:
 *   node scripts/verify-release-version.mjs              # uses GITHUB_REF_NAME or git describe
 *   node scripts/verify-release-version.mjs v2.6.6
 *   node scripts/verify-release-version.mjs 2.6.6
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalizeVersion(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const withoutPrefix = trimmed.replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(withoutPrefix)) {
    return null;
  }
  // Compare on major.minor.patch only (ignore pre-release / build metadata for updater artifacts)
  const [major, minor, patch] = withoutPrefix.split(/[-+]/)[0].split(".");
  return `${major}.${minor}.${patch}`;
}

function readJsonVersion(relPath, key = "version") {
  const path = join(ROOT, relPath);
  const json = JSON.parse(readFileSync(path, "utf8"));
  return { path: relPath, version: normalizeVersion(json[key]) };
}

function readCargoVersions() {
  const crates = [
    "src-tauri/hg-gui/Cargo.toml",
    "src-tauri/hg-core/Cargo.toml",
    "src-tauri/hg-serve/Cargo.toml",
    "src-tauri/hgc/Cargo.toml",
  ];
  return crates.map((relPath) => {
    const cargo = readFileSync(join(ROOT, relPath), "utf8");
    const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
    return { path: relPath, version: normalizeVersion(match?.[1] ?? null) };
  });
}

function resolveExpectedRaw() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.EXPECTED_VERSION) return process.env.EXPECTED_VERSION;
  try {
    return execSync("git describe --tags --exact-match", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  const expectedRaw = resolveExpectedRaw();
  const expected = normalizeVersion(expectedRaw);

  if (!expected) {
    console.error(
      "verify-release-version: could not resolve expected version.\n" +
        "Pass a tag (e.g. v2.6.6), or set GITHUB_REF_NAME / EXPECTED_VERSION.",
    );
    process.exit(1);
  }

  const sources = [
    readJsonVersion("package.json"),
    readJsonVersion("src-tauri/hg-gui/tauri.conf.json"),
    readJsonVersion("src-tauri/hg-gui/workspace/tauri.conf.json"),
    ...readCargoVersions(),
  ];

  console.log(`Expected release version: ${expected} (from ${expectedRaw})`);
  let failed = false;

  for (const src of sources) {
    if (!src.version) {
      failed = true;
      console.error(`❌ ${src.path}: missing or invalid version`);
      continue;
    }
    if (src.version !== expected) {
      failed = true;
      console.error(`❌ ${src.path}: ${src.version} !== ${expected}`);
    } else {
      console.log(`✅ ${src.path}: ${src.version}`);
    }
  }

  if (failed) {
    console.error(
      "\nRelease aborted: tag/version mismatch.\n" +
        "Bump versions first (pnpm version:patch|minor|major), commit, then tag the SAME version.\n" +
        "Otherwise latest.json / installer filenames will not match the GitHub tag and clients will not see the update.",
    );
    process.exit(1);
  }

  console.log("\nAll version sources match. OK to release.");
}

main();
