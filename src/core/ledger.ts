// Observation ledger: attempts/successes/latency per action plus decision
// counts. This is knowledge (persisted), never permission (memory-only).

import { score } from "./budget.js";
import type { ActionSpec, ObserveReport } from "./types.js";

export interface DecisionCounts {
  autoExecute: number;
  needConfirm: number;
  deny: number;
}

export interface LedgerSnapshot {
  stats: Record<string, { attempts: number; successes: number; totalMs: number; totalEnergy: number }>;
  decisions: DecisionCounts;
}

export class OutcomeLedger {
  private readonly stats = new Map<string, { attempts: number; successes: number; totalMs: number; totalEnergy: number }>();
  readonly decisions: DecisionCounts = { autoExecute: 0, needConfirm: 0, deny: 0 };

  stat(action: string): { attempts: number; successes: number; totalMs: number; totalEnergy: number } | undefined {
    return this.stats.get(action);
  }

  record(action: string, spec: ActionSpec, ok: boolean, ms: number): ObserveReport {
    const current = this.stats.get(action) ?? { attempts: 0, successes: 0, totalMs: 0, totalEnergy: 0 };
    current.attempts += 1;
    if (ok) current.successes += 1;
    current.totalMs += ms;
    current.totalEnergy += (ms / 1000) * Math.max(1, spec.energyWeight);
    this.stats.set(action, current);
    return {
      action,
      ok,
      ms,
      attempts: current.attempts,
      successes: current.successes,
      ratio: score(current, spec).ratio
    };
  }

  noteDecision(decision: "autoExecute" | "needConfirm" | "deny"): void {
    this.decisions[decision] += 1;
  }

  globalAccuracy(): number {
    let attempts = 0;
    let successes = 0;
    for (const stat of this.stats.values()) {
      attempts += stat.attempts;
      successes += stat.successes;
    }
    return attempts === 0 ? 0.995 : successes / attempts;
  }

  snapshot(): LedgerSnapshot {
    return {
      stats: Object.fromEntries(this.stats),
      decisions: { ...this.decisions }
    };
  }

  restore(snapshot: LedgerSnapshot): void {
    this.stats.clear();
    const source = snapshot as Partial<LedgerSnapshot>;
    for (const [action, stat] of Object.entries(source.stats ?? {})) {
      this.stats.set(action, { ...stat });
    }
    Object.assign(this.decisions, {
      autoExecute: source.decisions?.autoExecute ?? 0,
      needConfirm: source.decisions?.needConfirm ?? 0,
      deny: source.decisions?.deny ?? 0
    });
  }
}
