import { describe, expect, it } from "vitest";

import {
  aliasScore,
  confidenceWeight,
  expandTerms,
  metadataScore,
  normalizeText,
  queryTerms,
  statusWeight
} from "./semantic.js";

describe("semantic helpers", () => {
  it("normalizes punctuation, width and case", () => {
    expect(normalizeText("  交付，流程！ ")).toBe("交付 流程");
    expect(normalizeText("ＤＥＬＩＶＥＲＹ")).toBe("delivery");
  });

  it("extracts query terms", () => {
    expect([...queryTerms("交付 flow")].sort()).toEqual(["flow", "交付"]);
  });

  it("expands synonym groups when a member appears", () => {
    const expanded = expandTerms("交付物", [["交付", "交付物", "deliverable"]]);
    expect(expanded.has("交付")).toBe(true);
    expect(expanded.has("deliverable")).toBe(true);
  });

  it("scores aliases and metadata", () => {
    const expanded = expandTerms("交付物", [["交付", "交付物", "deliverable"]]);
    expect(aliasScore("交付物", ["交付"], expanded)).toBeGreaterThan(0);
    expect(aliasScore("交付物", ["安全"], expanded)).toBe(0);
    expect(metadataScore("delivery", ["workflow"], queryTerms("delivery workflow"))).toBeGreaterThan(0);
  });

  it("weights status and confidence", () => {
    expect(statusWeight("active")).toBe(1);
    expect(statusWeight("draft")).toBe(0.85);
    expect(statusWeight("deprecated")).toBe(0.5);
    expect(confidenceWeight(0)).toBe(0.5);
    expect(confidenceWeight(1)).toBe(1);
  });
});
