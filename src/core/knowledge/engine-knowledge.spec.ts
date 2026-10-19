import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineForPack } from "../../packs/loader.js";
import { tempDir } from "../../test-support/temp.js";

let temp: ReturnType<typeof tempDir> | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function setup() {
  temp = tempDir("ruling-knowledge-");
  const root = temp.path;
  const stateFile = join(root, ".ruling", "state.json.gz");
  const dir = join(root, ".ruling", "knowledge");
  const { engine } = createEngineForPack("opc", { workspace: { root } });
  return { root, stateFile, dir, engine };
}

function lines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
}

describe("separated knowledge libraries", () => {
  it("persists experience and failure lessons separately, never seed", async () => {
    const { root, stateFile, dir, engine } = setup();

    let outcome = await engine.execute({
      task: "登记经验",
      action: "knowledge.add",
      params: { id: "exp:1", title: "交付顺序", body: "先写文档再构建" },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("needConfirm");
    engine.approve("登记经验", "owner");
    outcome = await engine.execute({
      task: "登记经验",
      action: "knowledge.add",
      params: { id: "exp:1", title: "交付顺序", body: "先写文档再构建" },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("ok");

    outcome = await engine.execute({
      task: "登记教训",
      action: "lesson.add",
      params: { id: "lesson:1", title: "不要直接写 STEP", body: "走 cad.import", uses: ["cad.import"] },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("needConfirm");
    engine.approve("登记教训", "owner");
    outcome = await engine.execute({
      task: "登记教训",
      action: "lesson.add",
      params: { id: "lesson:1", title: "不要直接写 STEP", body: "走 cad.import", uses: ["cad.import"] },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("ok");

    engine.save(stateFile);

    const experience = lines(join(dir, "experience.jsonl"));
    const errors = lines(join(dir, "errors.jsonl"));
    expect(experience.some((line) => line.includes('"id":"exp:1"'))).toBe(true);
    expect(experience.some((line) => line.includes('"id":"seed:'))).toBe(false);
    expect(errors.some((line) => line.includes('"id":"lesson:1"'))).toBe(true);
    expect(errors.some((line) => line.includes('"kind":"error"'))).toBe(true);

    const state = gunzipSync(readFileSync(stateFile)).toString("utf8");
    expect(state).not.toContain('"units"');
    expect(state).not.toContain("lesson:1");
    expect(root).toBeTruthy();
  });

  it("keeps seed out of the snapshot and applies seed changes after restore", () => {
    const { stateFile, dir, engine } = setup();
    engine.save(stateFile);

    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "seed.json"),
      JSON.stringify([{ id: "local:1", title: "本地规则 v1", body: "v1" }])
    );
    const first = createEngineForPack("opc", { workspace: { root: temp?.path ?? "" } }).engine;
    expect(first.knowledgeUnits("seed").some((unit) => unit.id === "local:1")).toBe(true);
    first.save(stateFile);

    writeFileSync(
      join(dir, "seed.json"),
      JSON.stringify([{ id: "local:1", title: "本地规则 v2", body: "v2" }])
    );
    const second = createEngineForPack("opc", { workspace: { root: temp?.path ?? "" } }).engine;
    second.restore(stateFile);
    expect(second.knowledgeUnits("seed").find((unit) => unit.id === "local:1")?.title).toBe(
      "本地规则 v2"
    );
  });

  it("restores experience and failure lessons into a new engine", async () => {
    const { root, stateFile, engine } = setup();
    engine.surface.knowledge.add({
      id: "exp:restore",
      kind: "extended",
      title: "恢复经验",
      body: "should survive",
      origin: "runtime"
    });
    engine.surface.knowledge.add({
      id: "lesson:restore",
      kind: "error",
      title: "恢复教训",
      body: "should survive too",
      origin: "runtime"
    });
    engine.save(stateFile);

    const restored = createEngineForPack("opc", { workspace: { root } }).engine;
    restored.restore(stateFile);
    expect(restored.knowledgeUnits("extended").some((unit) => unit.id === "exp:restore")).toBe(true);
    expect(restored.knowledgeUnits("error").some((unit) => unit.id === "lesson:restore")).toBe(true);
    expect(restored.knowledgeUnits("seed").length).toBeGreaterThan(0);
  });

  it("loads external knowledge but never persists it", async () => {
    const { root, stateFile, dir, engine } = setup();
    writeFileSync(
      join(root, "external.json"),
      JSON.stringify([{ id: "remote", title: "外部知识", body: "remote body" }])
    );
    const report = await engine.loadExternalKnowledge([
      { id: "kb", type: "json", path: "external.json" }
    ]);
    expect(report.loaded).toBe(1);
    expect(engine.knowledgeUnits("extended").some((unit) => unit.origin === "external:kb")).toBe(true);

    engine.save(stateFile);
    const experience = readFileSync(join(dir, "experience.jsonl"), "utf8");
    expect(experience).not.toContain("ext:kb:");

    const restored = createEngineForPack("opc", { workspace: { root } }).engine;
    restored.restore(stateFile);
    expect(restored.knowledgeUnits("extended").some((unit) => unit.origin === "external:kb")).toBe(false);

    await restored.loadExternalKnowledge([{ id: "kb", type: "json", path: "external.json" }]);
    expect(restored.knowledgeUnits("extended").some((unit) => unit.origin === "external:kb")).toBe(true);
  });

  it("records an automatic failure lesson with reason and code", async () => {
    const { stateFile, dir, engine } = setup();
    const outcome = await engine.execute({
      task: "坏路径",
      action: "doc.write",
      params: { path: "../outside.md", content: "x" },
      trust: "operator",
      source: "test"
    });
    expect(outcome.status).toBe("error");
    expect(outcome.errorCode).toBe("PATH_ESCAPE");

    const lesson = engine
      .knowledgeUnits("error")
      .find((unit) => unit.id === "failure:doc.write");
    expect(lesson).toBeDefined();
    expect(lesson?.body).toContain("PATH_ESCAPE");

    engine.save(stateFile);
    expect(readFileSync(join(dir, "errors.jsonl"), "utf8")).toContain("failure:doc.write");
  });

  it("hydrates legacy version-1 snapshots with semantic defaults", () => {
    const { root, stateFile } = setup();
    const legacy = {
      version: 1,
      savedAt: 0,
      knowledge: {
        units: [
          {
            id: "legacy",
            kind: "extended",
            title: "旧经验",
            summary: "",
            body: "旧经验",
            tags: [],
            createdAt: 1,
            hits: 0,
            lastHitAt: 0,
            hot: true
          }
        ],
        graph: { edges: [] }
      },
      ledger: { stats: {}, decisions: { autoExecute: 0, needConfirm: 0, deny: 0 } }
    };
    mkdirSync(join(root, ".ruling"), { recursive: true });
    writeFileSync(stateFile, gzipSync(JSON.stringify(legacy)));

    const restored = createEngineForPack("opc", { workspace: { root } }).engine;
    expect(restored.restore(stateFile)).toBe(true);
    expect(restored.surface.knowledge.get("legacy")).toMatchObject({
      namespace: "local",
      aliases: [],
      status: "active",
      confidence: 0.8,
      version: 1
    });
  });

  it("manages the semantic lifecycle: review, merge, deprecate and restore metadata", async () => {
    const { root, stateFile, engine } = setup();
    const approved = async (task: string, action: string, params: Record<string, unknown>) => {
      const request = {
        task,
        action,
        params,
        trust: "agent" as const,
        source: "test" as const
      };
      let outcome = await engine.execute(request);
      if (outcome.status === "needConfirm") {
        engine.approve(task, "owner");
        outcome = await engine.execute(request);
      }
      return outcome;
    };

    let outcome = await approved("登记规范", "knowledge.add", {
      id: "exp:canonical",
      title: "交付流程",
      body: "先写文档再构建",
      namespace: "company",
      domain: "delivery",
      aliases: ["交付物", "deliverable"],
      tags: ["workflow"],
      uses: ["doc.write"],
      status: "draft",
      confidence: 0.6
    });
    expect(outcome.status).toBe("ok");

    outcome = await approved("登记重复", "knowledge.add", {
      id: "exp:duplicate",
      title: "交付流程",
      body: "先写文档再构建",
      namespace: "company",
      aliases: ["交付物"],
      tags: ["workflow", "legacy"],
      uses: ["project.build"]
    });
    expect(outcome.status).toBe("ok");

    outcome = await approved("审核规范", "knowledge.review", {
      id: "exp:canonical",
      confidence: 0.95
    });
    expect(outcome.status).toBe("ok");
    expect(engine.surface.knowledge.get("exp:canonical")).toMatchObject({
      status: "active",
      confidence: 0.95,
      reviewedBy: "owner"
    });

    outcome = await approved("合并重复", "knowledge.merge", {
      canonicalId: "exp:canonical",
      duplicateIds: ["exp:duplicate"]
    });
    expect(outcome.status).toBe("ok");
    const canonical = engine.surface.knowledge.get("exp:canonical");
    const duplicate = engine.surface.knowledge.get("exp:duplicate");
    expect(canonical?.aliases).toEqual(["交付物", "deliverable"]);
    expect(canonical?.tags).toEqual(["workflow", "legacy"]);
    expect(canonical?.uses).toEqual(["doc.write", "project.build"]);
    expect(canonical?.supersedes).toEqual(["exp:duplicate"]);
    expect(duplicate).toMatchObject({ status: "deprecated", supersededBy: "exp:canonical" });

    outcome = await approved("废弃旧教训", "lesson.add", {
      id: "lesson:old",
      title: "旧做法",
      body: "已废弃",
      status: "active"
    });
    expect(outcome.status).toBe("ok");
    outcome = await approved("废弃旧教训", "knowledge.deprecate", {
      id: "lesson:old",
      reason: "被新流程替代",
      supersededBy: "exp:canonical"
    });
    expect(outcome.status).toBe("ok");
    expect(engine.surface.knowledge.get("lesson:old")).toMatchObject({
      status: "deprecated",
      supersededBy: "exp:canonical"
    });

    engine.save(stateFile);
    const restored = createEngineForPack("opc", { workspace: { root } }).engine;
    restored.restore(stateFile);
    expect(restored.surface.knowledge.get("exp:canonical")).toMatchObject({
      namespace: "company",
      domain: "delivery",
      status: "active",
      confidence: 0.95,
      reviewedBy: "owner"
    });
    expect(restored.surface.knowledge.get("exp:duplicate")?.supersededBy).toBe("exp:canonical");
  });

  it("rejects knowledge ids that would shadow observation units", async () => {
    const { engine } = setup();
    engine.approve("登记保留前缀", "owner");
    const outcome = await engine.execute({
      task: "登记保留前缀",
      action: "knowledge.add",
      params: { id: "task:abcd1234", title: "越权", body: "x" },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("error");
    expect(outcome.errorCode).toBe("EXECUTOR_ERROR");
    expect(String((outcome.result as { error?: unknown }).error)).toContain("保留前缀");
    expect(engine.surface.knowledge.get("task:abcd1234")).toBeUndefined();
  });

  it("rejects reserved prefixes in merge targets too", async () => {
    const { engine } = setup();
    engine.approve("合并保留前缀", "owner");
    const outcome = await engine.execute({
      task: "合并保留前缀",
      action: "knowledge.merge",
      params: { canonicalId: "outcome:ok", duplicateIds: [] },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("error");
    expect(outcome.errorCode).toBe("EXECUTOR_ERROR");
    expect(String((outcome.result as { error?: unknown }).error)).toContain("保留前缀");
  });
});
