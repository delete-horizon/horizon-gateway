/**
 * Build horizon-gateway-serve + hgc and copy to Tauri bundle staging.
 *
 * Output:
 *   src-tauri/hg-gui/binaries/horizon-gateway-serve-{target-triple}[.exe]
 *   src-tauri/hg-gui/binaries/hgc-{target-triple}[.exe]
 *   src-tauri/hg-gui/binaries/horizon-gateway-workspace-{target-triple}[.exe]
 * build.rs copies these into resources/ for bundling.
 *
 * Usage: node scripts/build-serve-sidecar.mjs [--debug] [--target <triple>]
 *
 * `beforeBuildCommand` receives `TAURI_ENV_TARGET_TRIPLE` from the Tauri CLI
 * (needed when CI passes `--target x86_64-apple-darwin` on an arm64 runner).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(root, "src-tauri");
const binariesDir = path.join(tauriDir, "hg-gui", "binaries");
const debug = process.argv.includes("--debug");
const profile = debug ? "dev" : "release";
const targetSubdir = debug ? "debug" : "release";
const SIDECARS = ["horizon-gateway-serve", "hgc"];

function hostTriple() {
	const result = spawnSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error("rustc --print host-tuple failed");
	}
	return result.stdout.trim();
}

function argValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index !== -1 && process.argv[index + 1]) {
		return process.argv[index + 1];
	}
	return undefined;
}

function resolveTriple() {
	return (
		argValue("--target") ||
		process.env.TAURI_ENV_TARGET_TRIPLE ||
		process.env.CARGO_BUILD_TARGET ||
		hostTriple()
	);
}

function findBuiltBinary(bin, ext, triple) {
	const candidates = [
		path.join(tauriDir, "target", triple, targetSubdir, `${bin}${ext}`),
		path.join(tauriDir, "target", targetSubdir, `${bin}${ext}`),
	];
	return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function run() {
	const triple = resolveTriple();
	const ext = process.platform === "win32" ? ".exe" : "";
	const cargoArgs = [
		"build",
		"-p",
		"horizon-gateway-serve",
		"-p",
		"hgc",
		"--profile",
		profile,
		"--target",
		triple,
	];

	console.log(`[build-serve-sidecar] cargo ${cargoArgs.join(" ")}…`);
	const build = spawnSync("cargo", cargoArgs, {
		cwd: tauriDir,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (build.status !== 0) {
		process.exit(build.status ?? 1);
	}

	fs.mkdirSync(binariesDir, { recursive: true });
	// The workspace GUI's release build.rs embeds externalBin. serve and hgc must
	// already be staged. The workspace binary itself cannot exist yet, so that
	// cargo build skips the bundle check and the copy below fills it in.
	copySidecars(SIDECARS, ext, triple);

	// Release only. `tauri build` enables `tauri/custom-protocol` for the Hub binary.
	// This sidecar is a plain cargo build, so without the feature Tauri stays in dev
	// and loads devUrl (http://localhost:1420). `--debug` must keep that dev URL.
	const workspaceFeatures = debug ? "workspace-shell" : "workspace-shell,custom-protocol";
	const workspaceArgs = [
		"build",
		"-p",
		"horizon-gateway",
		"--bin",
		"horizon-gateway-workspace",
		"--features",
		workspaceFeatures,
		"--profile",
		profile,
		"--target",
		triple,
	];
	console.log(`[build-serve-sidecar] cargo ${workspaceArgs.join(" ")}…`);
	const env = { ...process.env, HG_SKIP_BUNDLE_SIDECARS: "1" };
	delete env.TAURI_CONFIG;
	const workspaceBuild = spawnSync("cargo", workspaceArgs, {
		cwd: tauriDir,
		stdio: "inherit",
		shell: process.platform === "win32",
		env,
	});
	if (workspaceBuild.status !== 0) {
		process.exit(workspaceBuild.status ?? 1);
	}

	copySidecars(["horizon-gateway-workspace"], ext, triple);
}

function copySidecars(bins, ext, triple) {
	for (const bin of bins) {
		const src = findBuiltBinary(bin, ext, triple);
		const dest = path.join(binariesDir, `${bin}-${triple}${ext}`);
		if (!fs.existsSync(src)) {
			console.error(`[build-serve-sidecar] missing built binary: ${src}`);
			process.exit(1);
		}
		fs.copyFileSync(src, dest);
		console.log(`[build-serve-sidecar] → ${dest}`);
	}
}

run();
