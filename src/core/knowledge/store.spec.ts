import { describe, expect, it } from "vitest";

import { KnowledgeStore } from "./store.js";

const seed = {
  id: "seed:delivery",
  kind: "seed" as const,
  title: "交付闭环",
  summary: "写文档、构建、导出报告",
  body: "交付不是一段说明，而是可验收的产物。",
  tags: ["delivery"],
  uses: ["doc.write", "project.build"]
};

const extended = {
  id: "ext:old",
  kind: "extended" as const,
  title: "旧经验",
  summary: "很久以前的一次任务",
  body: "old experience",
  tags: ["task"],
  createdAt: 0
};

const errorUnit = {
  id: "error:format",
  kind: "error" as const,
  title: "格式锁错误",
  summary: "不要直接写 .step",
  body: "CAD 文件必须走导入通道",
  tags: ["error"]
};

describe("KnowledgeStore", () => {
  it("routes the most relevant unit first", () => {
    const store = new KnowledgeStore([seed, extended, errorUnit]);
    const hits = store.route("交付闭环", 3);
    expect(hits[0]?.id).toBe("seed:delivery");
    expect(store.get("seed:delivery")?.hits).toBe(1);
  });

  it("records observations as causal edges and units", () => {
    const store = new KnowledgeStore([seed]);
    store.recordObservation("写交付文档", "doc.write", true, 1000);
    const action = store.get("action:doc.write");
    expect(action).toBeDefined();
    expect(store.get("outcome:ok")).toBeDefined();
    expect(store.graph.neighbors("action:doc.write", 1000).length).toBeGreaterThan(0);
  });

  it("demotes cold extended units but keeps seed and error units hot", () => {
    const store = new KnowledgeStore([seed, extended, errorUnit]);
    const result = store.tick(Date.now());
    expect(result.demoted).toBeGreaterThanOrEqual(1);
    expect(store.get("ext:old")?.hot).toBe(false);
    expect(store.get("seed:delivery")?.hot).toBe(true);
    expect(store.get("error:format")?.hot).toBe(true);
  });

  it("round-trips a snapshot", () => {
    const store = new KnowledgeStore([seed]);
    store.recordObservation("写文档", "doc.write", false, 1000);
    const snapshot = store.snapshot();
    const restored = new KnowledgeStore();
    restored.restore(snapshot);
    expect(restored.all()).toHaveLength(store.all().length);
    expect(restored.graph.size()).toBe(store.graph.size());
    expect(restored.route("交付闭环", 1)[0]?.id).toBe("seed:delivery");
  });

  it("separates persistent units from seed and external units", () => {
    const store = new KnowledgeStore([seed]);
    store.add({ id: "exp", kind: "extended", title: "经验", body: "experience" });
    store.add({ id: "lesson", kind: "error", title: "教训", body: "lesson" });
    store.add({
      id: "ext:kb:a",
      kind: "extended",
      title: "外部",
      body: "external",
      origin: "external:kb"
    });

    expect(store.persistentUnits().map((unit) => unit.id).sort()).toEqual(["exp", "lesson"]);

    store.restorePersistent([]);
    expect(store.get("seed:delivery")).toBeDefined();
    expect(store.get("exp")).toBeUndefined();
    expect(store.get("lesson")).toBeUndefined();
    expect(store.get("ext:kb:a")).toBeDefined();
  });

  it("records a failure lesson with the reason and error code", () => {
    const store = new KnowledgeStore([seed]);
    store.recordObservation("坏路径", "doc.write", false, 1000, {
      reason: "路径越出工作区",
      errorCode: "PATH_ESCAPE"
    });
    const lesson = store.get("failure:doc.write");
    expect(lesson).toMatchObject({ kind: "error", origin: "runtime" });
    expect(lesson?.body).toContain("路径越出工作区");
    expect(lesson?.body).toContain("PATH_ESCAPE");
  });

  it("ranks alias matches and penalizes deprecated units", () => {
    const store = new KnowledgeStore([
      {
        id: "seed:active",
        kind: "seed",
        title: "交付流程",
        body: "交付流程",
        aliases: ["交付物", "deliverable"],
        domain: "delivery",
        confidence: 1
      },
      {
        id: "seed:deprecated",
        kind: "seed",
        title: "交付流程旧版",
        body: "交付流程",
        aliases: ["交付物"],
        status: "deprecated",
        confidence: 1
      },
      {
        id: "seed:other",
        kind: "seed",
        title: "天气",
        body: "天气"
      }
    ]);
    store.setSynonyms([["交付", "交付物", "deliverable"]]);

    const hits = store.search("交付物", { topK: 3 }, 1000);
    expect(hits[0]?.id).toBe("seed:active");
    expect(hits.find((hit) => hit.id === "seed:deprecated")?.score).toBeLessThan(
      hits[0]?.score ?? 0
    );

    const activeOnly = store.search("交付物", { status: "active" }, 1000);
    expect(activeOnly.some((hit) => hit.id === "seed:deprecated")).toBe(false);
  });

  it("filters by namespace, domain and tag", () => {
    const store = new KnowledgeStore([
      { id: "a", kind: "seed", title: "手册", body: "手册", namespace: "company", domain: "delivery", tags: ["kb"] },
      { id: "b", kind: "seed", title: "手册", body: "手册", namespace: "other", domain: "safety", tags: ["ops"] }
    ]);
    expect(store.search("手册", { namespace: "company" }, 1000).map((h) => h.id)).toEqual(["a"]);
    expect(store.search("手册", { domain: "safety" }, 1000).map((h) => h.id)).toEqual(["b"]);
    expect(store.search("手册", { tag: "kb" }, 1000).map((h) => h.id)).toEqual(["a"]);
  });

  it("detects duplicates, conflicts and reports stats", () => {
    const store = new KnowledgeStore([
      { id: "a", kind: "seed", title: "交付流程", body: "先写文档再构建", aliases: ["交付物"] },
      { id: "b", kind: "extended", title: "交付流程", body: "先写文档再构建", aliases: ["交付物"] },
      { id: "c", kind: "error", title: "冲突", body: "不要这样做", contradicts: ["a"] }
    ]);
    const duplicates = store.dedupe(0.95);
    expect(duplicates.some((pair) => pair.a === "a" && pair.b === "b")).toBe(true);
    expect(store.conflicts()).toEqual([{ a: "c", b: "a", reason: "contradicts" }]);
    expect(store.stats()).toMatchObject({ total: 3 });
    expect(store.stats().byKind).toMatchObject({ seed: 1, extended: 1, error: 1 });
  });

  it("updates metadata without losing identity or bumping created time", () => {
    const store = new KnowledgeStore([
      { id: "a", kind: "extended", title: "经验", body: "body", createdAt: 1000 }
    ]);
    const updated = store.update("a", { status: "deprecated", confidence: 0.4 });
    expect(updated).toMatchObject({ id: "a", status: "deprecated", confidence: 0.4, version: 2 });
    expect(updated?.createdAt).toBe(1000);
  });
});
