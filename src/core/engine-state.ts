// Persistence for the separated knowledge libraries and the graph/ledger
// state. Approvals are deliberately absent.

import type { RulingEngine } from "./engine.js";
import type { GraphSnapshot } from "./knowledge/graph.js";
import {
  hydrateUnit,
  loadState,
  readKnowledgeLibrary,
  saveState,
  writeKnowledgeLibrary
} from "./knowledge/snapshot.js";
import type { KnowledgeUnit } from "./knowledge/store-types.js";

export interface EngineStats {
  decisions: { autoExecute: number; needConfirm: number; deny: number };
  accuracy: number;
  actions: string[];
}

export function engineStats(engine: RulingEngine): EngineStats {
  return {
    decisions: { ...engine.ledger.decisions },
    accuracy: engine.ledger.globalAccuracy(),
    actions: engine.surface.catalog.specs().map((spec) => spec.id)
  };
}

export function saveEngine(engine: RulingEngine, filePath: string, now: number): void {
  const units = engine.surface.knowledge.persistentUnits();
  writeKnowledgeLibrary(
    engine.knowledgePaths.experienceFile,
    units.filter((unit) => unit.kind === "extended")
  );
  writeKnowledgeLibrary(
    engine.knowledgePaths.errorsFile,
    units.filter((unit) => unit.kind === "error")
  );
  saveState(filePath, {
    version: 2,
    savedAt: now,
    graph: engine.surface.knowledge.graphSnapshot(),
    ledger: engine.ledger.snapshot()
  });
}

export function restoreEngine(engine: RulingEngine, filePath: string): boolean {
  const experience = readKnowledgeLibrary(engine.knowledgePaths.experienceFile);
  const errors = readKnowledgeLibrary(engine.knowledgePaths.errorsFile);
  const local = [...experience, ...errors];
  if (local.length > 0) engine.surface.knowledge.restorePersistent(local);

  const state = loadState(filePath);
  if (!state) return local.length > 0;

  if (state.version === 1) {
    const knowledge = state.knowledge as
      | { units?: KnowledgeUnit[]; graph?: GraphSnapshot }
      | undefined;
    const legacy = (knowledge?.units ?? [])
      .map((unit) => hydrateUnit(unit))
      .filter((unit): unit is KnowledgeUnit => unit !== undefined)
      .filter((unit) => unit.kind !== "seed" && !(unit.origin ?? "").startsWith("external:"));
    if (legacy.length > 0) {
      const merged = new Map(local.map((unit) => [unit.id, unit]));
      for (const unit of legacy) merged.set(unit.id, unit);
      engine.surface.knowledge.restorePersistent([...merged.values()]);
    }
    engine.surface.knowledge.restoreGraph(knowledge?.graph ?? { edges: [] });
  } else {
    engine.surface.knowledge.restoreGraph(state.graph);
  }

  engine.ledger.restore(state.ledger);
  return true;
}
