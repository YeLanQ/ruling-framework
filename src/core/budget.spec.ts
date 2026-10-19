import { describe, expect, it } from "vitest";

import { AUTO_RATIO, autoEligible, score } from "./budget.js";
import type { ActionSpec } from "./types.js";

const spec: ActionSpec = {
  id: "workspace.read",
  title: "read",
  description: "read",
  keywords: [],
  group: "read",
  zone: "green",
  speedBudgetMs: 2000,
  energyWeight: 1
};

describe("efficiency budget", () => {
  it("starts at the Laplacian prior with no history", () => {
    const breakdown = score(undefined, spec);
    expect(breakdown.accuracy).toBeCloseTo(0.995, 5);
    expect(breakdown.speed).toBe(1);
    expect(breakdown.energy).toBe(1);
    expect(breakdown.ratio).toBeCloseTo(0.995, 5);
  });

  it("drops below the 0.99 gate after 1 failure in 20 attempts", () => {
    const breakdown = score(
      { attempts: 20, successes: 19, totalMs: 2000, totalEnergy: 2 },
      spec
    );
    expect(breakdown.accuracy).toBeCloseTo(0.98, 5);
    expect(breakdown.ratio).toBeCloseTo(0.98, 5);
    expect(breakdown.ratio).toBeLessThan(AUTO_RATIO);
    expect(autoEligible(breakdown)).toBe(false);
  });

  it("penalizes slow calls through the speed and energy components", () => {
    const breakdown = score(
      { attempts: 10, successes: 10, totalMs: 100_000, totalEnergy: 100 },
      spec
    );
    expect(breakdown.speed).toBeCloseTo(0.2, 5);
    expect(breakdown.energy).toBeCloseTo(0.5, 5);
    expect(breakdown.ratio).toBeLessThan(0.5);
  });

  it("is auto-eligible when the ratio reaches the threshold", () => {
    expect(autoEligible(score(undefined, spec))).toBe(true);
  });
});
