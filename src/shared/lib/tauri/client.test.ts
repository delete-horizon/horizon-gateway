import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { type CoreClient, invoke, listen, resetCoreClient, setCoreClient } from "./client";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("core client adapter", () => {
  beforeEach(() => {
    resetCoreClient();
    vi.mocked(tauriInvoke).mockReset();
    vi.mocked(tauriListen).mockReset();
  });

  it("forwards a command with no args to Tauri invoke", async () => {
    vi.mocked(tauriInvoke).mockResolvedValue({ ok: true });

    await expect(invoke("get_domains")).resolves.toEqual({ ok: true });

    expect(tauriInvoke).toHaveBeenCalledTimes(1);
    expect(tauriInvoke).toHaveBeenCalledWith("get_domains");
  });

  it("forwards command arguments to Tauri invoke", async () => {
    vi.mocked(tauriInvoke).mockResolvedValue(null);
    const args = { payload: { urls: ["https://example.dev"] } };

    await invoke("regist_domains", args);

    expect(tauriInvoke).toHaveBeenCalledWith("regist_domains", args);
  });

  it("forwards listen and returns the Tauri unlisten function", async () => {
    const unlisten = vi.fn();
    vi.mocked(tauriListen).mockResolvedValue(unlisten);
    const handler = () => {};

    await expect(listen("serve-ready", handler)).resolves.toBe(unlisten);
    expect(tauriListen).toHaveBeenCalledWith("serve-ready", handler);
  });

  it("forwards listen options when the caller passes them", async () => {
    vi.mocked(tauriListen).mockResolvedValue(() => {});
    const handler = () => {};
    const options = { target: "main" };

    await listen("proxy-status-changed", handler, options);

    expect(tauriListen).toHaveBeenCalledWith("proxy-status-changed", handler, options);
  });

  it("uses a replacement client instead of Tauri", async () => {
    const unlisten = vi.fn();
    const nextInvoke = vi.fn(async () => "direct");
    const nextListen = vi.fn(async () => unlisten);
    setCoreClient({
      invoke: nextInvoke as CoreClient["invoke"],
      listen: nextListen as CoreClient["listen"],
    });
    const handler = () => {};

    await expect(invoke("ping")).resolves.toBe("direct");
    await expect(listen("ping", handler)).resolves.toBe(unlisten);

    expect(tauriInvoke).not.toHaveBeenCalled();
    expect(tauriListen).not.toHaveBeenCalled();
    expect(nextInvoke).toHaveBeenCalledWith("ping", undefined, undefined);
    expect(nextListen).toHaveBeenCalledWith("ping", handler, undefined);
  });

  it("restores Tauri forwarding after a replacement client", async () => {
    setCoreClient({
      invoke: (async () => "other") as CoreClient["invoke"],
      listen: async () => () => {},
    });
    resetCoreClient();
    vi.mocked(tauriInvoke).mockResolvedValue("back");

    await expect(invoke("ping", { n: 1 })).resolves.toBe("back");
    expect(tauriInvoke).toHaveBeenCalledWith("ping", { n: 1 });
  });

  it("keeps invoke and listen on this module", () => {
    const adapter = path.join(srcRoot, "shared/lib/tauri/client.ts");
    const invokeFromTauri = /import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*["']@tauri-apps\/api\/core["']/;
    const listenFromTauri = /import\s*\{[^}]*\blisten\b[^}]*\}\s*from\s*["']@tauri-apps\/api\/event["']/;
    const dynamicTauriInvoke = /import\(\s*["']@tauri-apps\/api\/core["']\s*\)/;
    const offenders: string[] = [];

    for (const file of sourceFiles(srcRoot)) {
      if (file === adapter || file.endsWith(".test.ts")) {
        continue;
      }
      const flat = readFileSync(file, "utf8").replace(/\s+/g, " ");
      if (invokeFromTauri.test(flat) || dynamicTauriInvoke.test(flat) || listenFromTauri.test(flat)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
    const bindings = readFileSync(path.join(srcRoot, "bindings.ts"), "utf8");
    expect(bindings).toContain('from "./shared/lib/tauri/client"');
    expect(bindings).not.toContain("@tauri-apps/api/core");
  });
});
