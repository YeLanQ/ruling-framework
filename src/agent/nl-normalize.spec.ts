import { describe, expect, it } from "vitest";

import { MockProvider, text } from "./mock-provider.js";
import { normalizeTaskSpec } from "./nl-normalize.js";

const valid = {
  taskType: "edit",
  taskDescription: "写交付文档",
  anchors: ["交付文档"],
  fileRefs: ["a.md", "missing.md"],
  ambiguities: [],
  confidence: 0.82
};

describe("NormSpec", () => {
  it("structures a task and verifies file references by existence only", async () => {
    const provider = new MockProvider([text(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)]);
    const normalized = await normalizeTaskSpec(provider, "mock", "写个交付文档", {
      fileExists: async (path) => path === "a.md"
    });
    expect(normalized).toMatchObject({
      taskType: "edit",
      taskDescription: "写交付文档",
      anchors: ["交付文档"],
      fileRefs: ["a.md"],
      confidence: 0.82
    });
  });

  it("falls back to undefined on malformed output", async () => {
    const provider = new MockProvider([text("这不是 JSON")]);
    expect(await normalizeTaskSpec(provider, "mock", "任务")).toBeUndefined();
  });

  it("falls back to undefined when the provider fails or is exhausted", async () => {
    const provider = new MockProvider([]);
    expect(await normalizeTaskSpec(provider, "mock", "任务")).toBeUndefined();
  });

  it("does not treat an empty description as a valid normalization", async () => {
    const provider = new MockProvider([
      text(JSON.stringify({ ...valid, taskDescription: "   " }))
    ]);
    expect(await normalizeTaskSpec(provider, "mock", "任务")).toBeUndefined();
  });
});
