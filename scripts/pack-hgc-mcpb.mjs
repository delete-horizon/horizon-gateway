#!/usr/bin/env node
/**
 * Pack Windows x64 and Linux x64 `hgc` into one MCPB, and write the
 * server.json the MCP Registry publisher uploads.
 *
 * macOS is omitted. The MCPB manifest only lists darwin / win32 / linux, and
 * the macOS hgc binaries are unsigned and not notarized.
 *
 *   node scripts/pack-hgc-mcpb.mjs --check
 *   node scripts/pack-hgc-mcpb.mjs --dry-run
 *   node scripts/pack-hgc-mcpb.mjs --linux hgc --windows hgc.exe --version 2.8.15 \
 *     --out dist/horizon-gateway.mcpb --server-json dist/server.json
 */
import { deepEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCPB_CLI_VERSION = "2.1.2";
const ASSET_NAME = "horizon-gateway.mcpb";
const SERVER_NAME = "io.github.delete-horizon/horizon-gateway";
const SERVER_DESCRIPTION =
  "Read-only local proxy tools. The free Horizon Gateway app must be running.";
const SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    check: false,
    writeTemplate: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case "--linux":
        out.linux = next();
        break;
      case "--windows":
        out.windows = next();
        break;
      case "--version":
        out.version = next();
        break;
      case "--out":
        out.out = next();
        break;
      case "--server-json":
        out.serverJson = next();
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--check":
        out.check = true;
        break;
      case "--write-template":
        out.writeTemplate = true;
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return out;
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    fail(`package.json version is not major.minor.patch: ${pkg.version}`);
  }
  return pkg.version;
}

function releaseUrl(version) {
  return `https://github.com/delete-horizon/horizon-gateway/releases/download/v${version}/${ASSET_NAME}`;
}

function templateServer(version) {
  return {
    $schema: SCHEMA,
    name: SERVER_NAME,
    title: "Horizon Gateway",
    description: SERVER_DESCRIPTION,
    version,
    websiteUrl: "https://gateway.delete-horizon.com",
    repository: {
      url: "https://github.com/delete-horizon/horizon-gateway",
      source: "github",
      id: "1153265292",
    },
    packages: [
      {
        registryType: "mcpb",
        identifier: releaseUrl(version),
        version,
        transport: {
          type: "stdio",
        },
      },
    ],
    _meta: {
      "io.modelcontextprotocol.registry/publisher-provided": {
        transport: "stdio",
        command: "hgc",
        args: ["mcp"],
        platforms: ["win32", "linux"],
        note: "fileSha256 is added by scripts/pack-hgc-mcpb.mjs when the release packs horizon-gateway.mcpb. Default args stay [\"mcp\"] (read-only). macOS is not in the bundle; use the hgc shipped inside the desktop app.",
      },
    },
  };
}

function publishServer(version, fileSha256) {
  const server = templateServer(version);
  const pkg = server.packages[0];
  server.packages[0] = {
    registryType: pkg.registryType,
    identifier: pkg.identifier,
    version: pkg.version,
    fileSha256,
    transport: pkg.transport,
  };
  return server;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertDescriptionLength() {
  if (SERVER_DESCRIPTION.length > 100) {
    fail(`server.json description is ${SERVER_DESCRIPTION.length} characters; the registry max is 100`);
  }
}

function manifest(version) {
  return {
    $schema:
      "https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json",
    manifest_version: "0.4",
    name: "horizon-gateway",
    display_name: "Horizon Gateway",
    version,
    description:
      "Read-only stdio tools for the local Horizon Gateway proxy. The free desktop app must be running. Launches the bundled hgc with argument mcp.",
    long_description:
      "This bundle runs `hgc mcp` (stdio, read-only). The free Horizon Gateway desktop app must already be running on this computer; the bundle does not start the proxy.\n\nWindows x64 and Linux x64 binaries are included. macOS is not. The macOS hgc binaries shipped with the desktop app are unsigned and not notarized, so Gatekeeper can block a copy extracted from a bundle, and the MCPB manifest has no per-architecture platform key. On macOS, run the hgc that ships inside the Horizon Gateway app.",
    author: {
      name: "Delete Horizon",
      email: "hello@delete-horizon.com",
      url: "https://gateway.delete-horizon.com",
    },
    repository: {
      type: "git",
      url: "https://github.com/delete-horizon/horizon-gateway",
    },
    homepage: "https://gateway.delete-horizon.com",
    documentation:
      "https://github.com/delete-horizon/horizon-gateway/blob/main/docs/mcp-registry.md",
    support: "https://github.com/delete-horizon/horizon-gateway/issues",
    server: {
      type: "binary",
      entry_point: "server/hgc",
      mcp_config: {
        command: "${__dirname}/server/hgc",
        args: ["mcp"],
        platform_overrides: {
          win32: {
            command: "${__dirname}/server/hgc.exe",
          },
        },
      },
    },
    compatibility: {
      platforms: ["win32", "linux"],
    },
    tools: [
      { name: "get_status", description: "Read whether the local proxy listener is running." },
      { name: "list_routes", description: "List local host-to-target routes." },
      { name: "list_mocks", description: "List mock rules." },
      { name: "list_domains", description: "List registered domains." },
      { name: "list_traffic", description: "List recent captured exchanges without headers or bodies." },
      { name: "get_config", description: "Read the saved proxy configuration." },
    ],
  };
}

function writeFixtures(dir) {
  const linux = join(dir, "hgc");
  const windows = join(dir, "hgc.exe");
  writeFileSync(linux, "#!/bin/sh\necho horizon-gateway-mcpb-dry-run\nexit 0\n");
  chmodSync(linux, 0o755);
  writeFileSync(windows, "MZ horizon-gateway-mcpb-dry-run\n");
  return { linux, windows };
}

function assertRealBinary(filePath, kind) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 64 * 1024) {
    fail(`${kind} binary is only ${bytes.length} bytes: ${filePath}`);
  }
  if (kind === "linux" && bytes.subarray(0, 4).toString("latin1") !== "\u007fELF") {
    fail(`linux hgc is not an ELF binary: ${filePath}`);
  }
  if (kind === "windows" && bytes.subarray(0, 2).toString("latin1") !== "MZ") {
    fail(`windows hgc is not a PE binary: ${filePath}`);
  }
}

function runMcpb(args) {
  const result = spawnSync("npx", ["--yes", `@anthropic-ai/mcpb@${MCPB_CLI_VERSION}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(
      `mcpb ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

function assertArchive(mcpbPath) {
  const script = `
import json, sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as zf:
    names = set(zf.namelist())
    required = {"manifest.json", "server/hgc", "server/hgc.exe"}
    missing = sorted(required - names)
    if missing:
        raise SystemExit("bundle missing " + ", ".join(missing))
    manifest = json.loads(zf.read("manifest.json"))
    platforms = manifest.get("compatibility", {}).get("platforms")
    if platforms != ["win32", "linux"]:
        raise SystemExit("unexpected platforms: " + json.dumps(platforms))
    args = manifest["server"]["mcp_config"]["args"]
    if args != ["mcp"]:
        raise SystemExit("unexpected args: " + json.dumps(args))
    if "darwin" in json.dumps(manifest):
        raise SystemExit("manifest mentions darwin")
    info = zf.getinfo("server/hgc")
    mode = (info.external_attr >> 16) & 0o777
    if mode & 0o111 == 0:
        raise SystemExit("server/hgc is not executable in the zip (mode %s)" % oct(mode))
print("mcpb archive ok")
`;
  const result = spawnSync("python3", ["-c", script, mcpbPath], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`archive check failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  process.stdout.write(result.stdout ?? "");
}

function assertPublished(server, mcpbPath, version) {
  const pkg = server.packages?.[0];
  if (!pkg) {
    fail("server.json has no packages entry");
  }
  if (pkg.registryType !== "mcpb") {
    fail(`registryType is ${pkg.registryType}`);
  }
  if (pkg.registryBaseUrl) {
    fail("mcpb packages must not set registryBaseUrl");
  }
  if (pkg.transport?.type !== "stdio") {
    fail("transport.type must be stdio");
  }
  if (pkg.identifier !== releaseUrl(version)) {
    fail(`identifier is ${pkg.identifier}`);
  }
  if (!pkg.identifier.includes("mcp")) {
    fail("identifier must contain mcp");
  }
  if (!/^https:\/\/github\.com\/delete-horizon\/horizon-gateway\/releases\/download\/v[^/]+\/horizon-gateway\.mcpb$/.test(pkg.identifier)) {
    fail(`identifier is not a GitHub release asset URL: ${pkg.identifier}`);
  }
  if (!/^[a-f0-9]{64}$/.test(pkg.fileSha256 ?? "")) {
    fail("fileSha256 must be 64 lowercase hex characters");
  }
  const actual = createHash("sha256").update(readFileSync(mcpbPath)).digest("hex");
  if (pkg.fileSha256 !== actual) {
    fail("fileSha256 does not match the mcpb file");
  }
  if (server.name !== SERVER_NAME) {
    fail(`server name is ${server.name}`);
  }
  if (server.description !== SERVER_DESCRIPTION) {
    fail("server description drifted");
  }
  const args = server._meta?.["io.modelcontextprotocol.registry/publisher-provided"]?.args;
  if (JSON.stringify(args) !== JSON.stringify(["mcp"])) {
    fail("published server.json args must stay [mcp]");
  }
}

function pack(args, version) {
  const work = mkdtempSync(join(tmpdir(), "horizon-gateway-mcpb-"));
  const fixtureDir = args.dryRun ? mkdtempSync(join(tmpdir(), "horizon-gateway-mcpb-fixture-")) : "";
  try {
    const serverDir = join(work, "server");
    mkdirSync(serverDir);
    const sources = args.dryRun
      ? writeFixtures(fixtureDir)
      : { linux: resolve(args.linux), windows: resolve(args.windows) };
    if (!args.dryRun) {
      assertRealBinary(sources.linux, "linux");
      assertRealBinary(sources.windows, "windows");
    }
    const linuxDest = join(serverDir, "hgc");
    const windowsDest = join(serverDir, "hgc.exe");
    writeFileSync(linuxDest, readFileSync(sources.linux));
    writeFileSync(windowsDest, readFileSync(sources.windows));
    chmodSync(linuxDest, 0o755);
    writeFileSync(join(work, "manifest.json"), serialize(manifest(version)));

    const validateOut = runMcpb(["validate", join(work, "manifest.json")]);
    process.stdout.write(validateOut);
    const outPath = resolve(args.out ?? join(ROOT, "dist", ASSET_NAME));
    mkdirSync(dirname(outPath), { recursive: true });
    const packOut = runMcpb(["pack", work, outPath]);
    process.stdout.write(packOut);
    assertArchive(outPath);

    const fileSha256 = createHash("sha256").update(readFileSync(outPath)).digest("hex");
    const server = publishServer(version, fileSha256);
    assertPublished(server, outPath, version);
    const jsonPath = resolve(args.serverJson ?? join(ROOT, "dist", "server.json"));
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, serialize(server));
    console.log(`wrote ${outPath}`);
    console.log(`sha256 ${fileSha256}`);
    console.log(`wrote ${jsonPath}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (fixtureDir) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }
}

function main() {
  assertDescriptionLength();
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? readPackageVersion();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`version must be major.minor.patch: ${version}`);
  }
  if (args.version && args.version !== readPackageVersion()) {
    fail(`--version ${args.version} does not match package.json ${readPackageVersion()}`);
  }

  if (args.writeTemplate) {
    writeFileSync(join(ROOT, "server.json"), serialize(templateServer(version)));
    console.log("wrote server.json");
  }

  if (args.check) {
    const actual = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));
    try {
      deepEqual(actual, templateServer(version));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`server.json does not match the MCPB template.\n${message}\nRun: node scripts/pack-hgc-mcpb.mjs --write-template`);
    }
    console.log("server.json template matches");
  }

  if (args.dryRun || args.linux || args.windows) {
    if (!args.dryRun && (!args.linux || !args.windows)) {
      fail("pass both --linux and --windows, or pass --dry-run");
    }
    pack(args, version);
  } else if (!args.check && !args.writeTemplate) {
    fail("pass --check, --dry-run, or --linux and --windows");
  }
}

main();
