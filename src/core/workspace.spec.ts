import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { Workspace } from "./workspace.js";

let temp: ReturnType<typeof tempDir>;
let workspace: Workspace;

beforeEach(() => {
  temp = tempDir("ruling-ws-");
  workspace = new Workspace({ root: temp.path });
});

afterEach(() => {
  temp.cleanup();
});

describe("Workspace data boundary", () => {
  it("writes and reads relative paths atomically", async () => {
    await workspace.write("docs/readme.md", "hello");
    expect(await workspace.read("docs/readme.md")).toBe("hello");
    expect(await workspace.exists("docs/readme.md")).toBe(true);
    const entries = await workspace.list("docs");
    expect(entries).toEqual([{ path: "docs/readme.md", type: "file", size: 5 }]);
  });

  it("rejects traversal, backslashes and absolute paths", async () => {
    await expect(workspace.read("../outside.txt")).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(workspace.write("a\\b.txt", "x")).rejects.toMatchObject({ code: "PATH_INVALID" });
    await expect(workspace.write("C:/temp/x.txt", "x")).rejects.toMatchObject({ code: "PATH_INVALID" });
  });

  it("keeps internal/ read-only", async () => {
    mkdirSync(`${temp.path}/internal`, { recursive: true });
    await expect(workspace.write("internal/engine.bin", "x")).rejects.toMatchObject({
      code: "INTERNAL_READONLY"
    });
  });

  it("locks managed formats to their dedicated channel", async () => {
    const locked = new Workspace({
      root: temp.path,
      formatLocks: [
        { extensions: [".pdf"], channel: "report.export", reason: "由导出通道管理" }
      ]
    });
    await expect(locked.write("report.pdf", "x")).rejects.toMatchObject({ code: "FORMAT_LOCKED" });
    await locked.write("report.pdf", "x", { channel: "report.export" });
    expect(await locked.read("report.pdf")).toBe("x");
  });

  it("enforces the write size limit", async () => {
    const small = new Workspace({ root: temp.path, maxWriteBytes: 10 });
    await expect(small.write("big.txt", "x".repeat(20))).rejects.toMatchObject({
      code: "SIZE_LIMIT"
    });
  });

  it("removes files but refuses the workspace root", async () => {
    await workspace.write("tmp/a.txt", "a");
    await workspace.remove("tmp/a.txt");
    expect(await workspace.exists("tmp/a.txt")).toBe(false);
    await expect(workspace.remove(".")).rejects.toMatchObject({ code: "PATH_INVALID" });
  });

  it("keeps internal/ read-only on remove as well", async () => {
    mkdirSync(`${temp.path}/internal`, { recursive: true });
    writeFileSync(`${temp.path}/internal/engine.bin`, "x");
    await expect(workspace.remove("internal/engine.bin")).rejects.toMatchObject({
      code: "INTERNAL_READONLY"
    });
  });

  it("locks managed formats on remove as well", async () => {
    const locked = new Workspace({
      root: temp.path,
      formatLocks: [
        { extensions: [".pdf"], channel: "report.export", reason: "由导出通道管理" }
      ]
    });
    writeFileSync(`${temp.path}/report.pdf`, "x");
    await expect(locked.remove("report.pdf")).rejects.toMatchObject({ code: "FORMAT_LOCKED" });
  });
});
