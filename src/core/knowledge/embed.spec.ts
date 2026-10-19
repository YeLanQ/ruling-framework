import { describe, expect, it } from "vitest";

import { cosine, embed, embedFloat, features } from "./embed.js";

describe("hash embedding", () => {
  it("is deterministic", () => {
    const first = embed("交付文档与设计参数");
    const second = embed("交付文档与设计参数");
    expect([...first.data]).toEqual([...second.data]);
  });

  it("is roughly self-similar and different across unrelated text", () => {
    const a = embed("交付文档");
    const b = embed("交付文档");
    const c = embed("安全参数认证");
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBeLessThan(0.99);
  });

  it("normalizes float vectors", () => {
    const vector = embedFloat("bracket design revision");
    const norm = Math.sqrt([...vector].reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("extracts ASCII words and CJK uni/bi-grams", () => {
    const tokens = features("DFM 检查");
    expect(tokens).toContain("w:dfm");
    expect(tokens).toContain("c:检");
    expect(tokens).toContain("b:检查");
  });
});
