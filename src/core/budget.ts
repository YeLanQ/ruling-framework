// Efficiency accounting, not a security control. The 0.99 ratio only decides
// whether a plan should stop interrupting the user; it never releases a yellow
// action on its own.

import type { ActionSpec } from "./types.js";

export const AUTO_RATIO = 0.99;
export const PRIOR_WEIGHT = 40;
export const PRIOR_ACCURACY = 0.995;
export const ENERGY_BUDGET = 5;

export interface StrategyStat {
  attempts: number;
  successes: number;
  totalMs: number;
  totalEnergy: number;
}

export interface ScoreBreakdown {
  ratio: number;
  accuracy: number;
  speed: number;
  energy: number;
  avgMs: number;
}

export function emptyStat(): StrategyStat {
  return { attempts: 0, successes: 0, totalMs: 0, totalEnergy: 0 };
}

export function score(stat: StrategyStat | undefined, spec: ActionSpec): ScoreBreakdown {
  const s = stat ?? emptyStat();
  const accuracy =
    (s.successes + PRIOR_WEIGHT * PRIOR_ACCURACY) / (s.attempts + PRIOR_WEIGHT);
  const avgMs = s.attempts > 0 ? s.totalMs / s.attempts : 0;

  const speed = avgMs > 0 ? Math.min(1, spec.speedBudgetMs / avgMs) : 1;
  const energy =
    avgMs > 0
      ? Math.min(1, ENERGY_BUDGET / ((avgMs / 1000) * Math.max(1, spec.energyWeight)))
      : 1;

  return {
    ratio: accuracy * (0.5 * speed + 0.5 * energy),
    accuracy,
    speed,
    energy,
    avgMs
  };
}

export function autoEligible(breakdown: ScoreBreakdown): boolean {
  return breakdown.ratio >= AUTO_RATIO;
}
