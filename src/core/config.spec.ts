import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { loadConfig } from "./config.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function writeConfig(partial: Record<string, unknown>): string {
  const temp = tempDir("ruling-config-");
  cleanups.push(temp.cleanup);
  const dir = join(temp.path, ".ruling");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ pack: "opc", ...partial }));
  return temp.path;
}

describe("workspace config", () => {
  it("loads defaults when no config file exists", () => {
    const temp = tempDir("ruling-config-");
    cleanups.push(temp.cleanup);
    const config = loadConfig(temp.path);
    expect(config.pack).toBe("opc");
    expect(config.trust).toBe("agent");
    expect(config.provider?.model).toBeTruthy();
  });

  it("rejects an invalid trust mode at load time", () => {
    const cwd = writeConfig({ trust: "root" });
    expect(() => loadConfig(cwd)).toThrow(/trust 非法/);
  });

  it("rejects a non-string role at load time", () => {
    const cwd = writeConfig({ role: "" });
    expect(() => loadConfig(cwd)).toThrow(/role 必须是非空字符串/);
  });

  it("rejects a missing pack", () => {
    const cwd = writeConfig({ pack: "" });
    expect(() => loadConfig(cwd)).toThrow(/缺少 pack/);
  });

  it("merges user overrides with defaults", () => {
    const cwd = writeConfig({ trust: "operator", role: "editor", knowledge: { dir: ".ruling/kb" } });
    const config = loadConfig(cwd);
    expect(config.trust).toBe("operator");
    expect(config.role).toBe("editor");
    expect(config.knowledge?.dir).toBe(".ruling/kb");
    expect(config.provider?.baseUrl).toBeTruthy();
  });
});
