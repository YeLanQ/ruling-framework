// Closed capability surface. If an action id is not registered here, no model
// proposal and no approval can make it execute.

import type { ActionSpec } from "./types.js";

export class ActionCatalog {
  private readonly byId = new Map<string, ActionSpec>();
  private readonly groupIds = new Map<string, string[]>();

  constructor(specs: ActionSpec[]) {
    for (const spec of specs) {
      if (this.byId.has(spec.id)) {
        throw new Error(`duplicate action id: ${spec.id}`);
      }
      this.byId.set(spec.id, spec);
      const ids = this.groupIds.get(spec.group) ?? [];
      ids.push(spec.id);
      this.groupIds.set(spec.group, ids);
    }
  }

  specs(): ActionSpec[] {
    return [...this.byId.values()];
  }

  get(id: string): ActionSpec | undefined {
    return this.byId.get(id);
  }

  isKnown(id: string): boolean {
    return this.byId.has(id);
  }

  groups(): string[] {
    return [...this.groupIds.keys()];
  }

  actionsInGroup(group: string): ActionSpec[] {
    return (this.groupIds.get(group) ?? [])
      .map((id) => this.byId.get(id))
      .filter((spec): spec is ActionSpec => spec !== undefined);
  }

  /** Case-insensitive keyword/title match used by the deterministic planner. */
  matchText(text: string): Array<{ spec: ActionSpec; score: number }> {
    const haystack = text.toLowerCase();
    const hits: Array<{ spec: ActionSpec; score: number }> = [];
    for (const spec of this.byId.values()) {
      let score = 0;
      if (haystack.includes(spec.title.toLowerCase())) score += 3;
      for (const keyword of spec.keywords) {
        if (keyword && haystack.includes(keyword.toLowerCase())) score += 2;
      }
      if (haystack.includes(spec.id.toLowerCase())) score += 4;
      if (score > 0) hits.push({ spec, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.spec.id.localeCompare(b.spec.id));
  }
}
