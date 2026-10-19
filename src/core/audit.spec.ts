import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { AuditLog, entryHash, type AuditInput } from "./audit.js";

const input = (action: string): AuditInput => ({
  source: "test",
  actorRole: "owner",
  task: "演示任务",
  action,
  zone: "yellow",
  decision: "needConfirm",
  status: "needConfirm",
  ok: false,
  ms: 0,
  reason: "等待批准"
});

let temp: ReturnType<typeof tempDir> | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

describe("AuditLog", () => {
  it("keeps only the configured ring size", () => {
    const log = new AuditLog({ ringSize: 3 });
    for (const action of ["a", "b", "c", "d"]) log.append(input(action));
    expect(log.entries()).toHaveLength(3);
    expect(log.entries().map((entry) => entry.action)).toEqual(["b", "c", "d"]);
    expect(log.entries()[0]?.seq).toBe(2);
  });

  it("verifies an intact hash chain", () => {
    const log = new AuditLog({ ringSize: 10 });
    log.append(input("a"));
    log.append(input("b"));
    expect(log.verifyChain()).toEqual({ ok: true });
  });

  it("detects a tampered entry", () => {
    const log = new AuditLog({ ringSize: 10 });
    log.append(input("a"));
    log.append(input("b"));
    const entries = log.entries();
    const second = entries[1];
    expect(second).toBeDefined();
    if (!second) return;
    second.reason = "tampered";
    expect(log.verifyChain(entries).ok).toBe(false);
  });

  it("detects task text tampering", () => {
    const log = new AuditLog({ ringSize: 10 });
    log.append(input("a"));
    log.append(input("b"));
    const entries = log.entries();
    const second = entries[1];
    expect(second).toBeDefined();
    if (!second) return;
    second.task = "changed task";
    expect(log.verifyChain(entries).ok).toBe(false);
  });

  it("continues the chain across process restarts and verifies the file", () => {
    temp = tempDir("ruling-audit-");
    const filePath = `${temp.path}/audit.jsonl`;
    const first = new AuditLog({ filePath, ringSize: 10 });
    first.append(input("a"));
    first.append(input("b"));
    const second = new AuditLog({ filePath, ringSize: 10 });
    second.append(input("c"));
    expect(second.verifyFile()).toEqual({ ok: true });
  });

  it("exports a markdown provenance report", () => {
    const log = new AuditLog();
    log.append(input("doc.write"));
    const report = log.exportMarkdown();
    expect(report).toContain("# Ruling Audit Report");
    expect(report).toContain("doc.write");
  });

  it("entryHash is stable for identical inputs", () => {
    const log = new AuditLog();
    const entry = log.append(input("a"));
    const { hash: _hash, ...rest } = entry;
    expect(entryHash(rest)).toBe(entry.hash);
  });
});
