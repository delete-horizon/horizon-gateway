#!/usr/bin/env node
/**
 * Bump version across package.json, tauri.conf.json, Cargo.toml.
 * Usage: node scripts/bump-version.mjs [patch|minor|major]
 * Creates git tag after bump. Run `git push && git push --tags` to publish.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseVersion(version) {
	const parts = version.split(".").map(Number);
	return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function bump(type, version) {
	const { major, minor, patch } = parseVersion(version);
	switch (type) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
		default:
			return `${major}.${minor}.${patch + 1}`;
	}
}

function main() {
	const type = process.argv[2] || "patch";
	if (!["patch", "minor", "major"].includes(type)) {
		console.error("Usage: node scripts/bump-version.mjs [patch|minor|major]");
		process.exit(1);
	}

	const pkgPath = join(ROOT, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	const current = pkg.version;
	const next = bump(type, current);

	// Update package.json
	pkg.version = next;
	writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

	// Update tauri.conf.json
	const tauriPath = join(ROOT, "src-tauri", "hg-gui", "tauri.conf.json");
	const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
	tauri.version = next;
	writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

	const workspaceTauriPath = join(ROOT, "src-tauri", "hg-gui", "workspace", "tauri.conf.json");
	const workspaceTauri = JSON.parse(readFileSync(workspaceTauriPath, "utf8"));
	workspaceTauri.version = next;
	writeFileSync(workspaceTauriPath, JSON.stringify(workspaceTauri, null, 2) + "\n");

	// Update workspace crate versions
	for (const crateRel of [
		"src-tauri/hg-gui/Cargo.toml",
		"src-tauri/hg-core/Cargo.toml",
		"src-tauri/hg-serve/Cargo.toml",
		"src-tauri/hgc/Cargo.toml",
	]) {
		const cargoPath = join(ROOT, crateRel);
		let cargo = readFileSync(cargoPath, "utf8");
		cargo = cargo.replace(/^version = ".*"$/m, `version = "${next}"`);
		writeFileSync(cargoPath, cargo);
	}

	const appMetaPath = join(ROOT, "src", "shared", "lib", "appMeta.ts");
	let appMeta = readFileSync(appMetaPath, "utf8");
	appMeta = appMeta.replace(
		/export const APP_VERSION = ".*";/,
		`export const APP_VERSION = "${next}";`,
	);
	writeFileSync(appMetaPath, appMeta);

	console.log(`Bumped ${current} → ${next}`);
	console.log("");
	console.log("Next steps:");
	console.log("  1. Update CHANGELOG.md with the new version");
	console.log("  2. git add -A && git commit -m \"chore: bump to v" + next + "\"");
	console.log(`  3. git tag v${next}`);
	console.log(`  4. pnpm version:verify v${next}   # catch tag/file drift before push`);
	console.log("  5. git push && git push --tags");
}

main();
