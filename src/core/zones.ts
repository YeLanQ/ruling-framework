// Zone resolution. A pack can register dynamic resolvers for actions whose
// zone depends on context (for example, a safety-critical design parameter).
// The default resolver is the static zone declared on the action.

import type { ActionSpec, WorkspaceApi, Zone } from "./types.js";

export interface ZoneContext {
  task: string;
  action: ActionSpec;
  params: Record<string, unknown>;
  workspace: WorkspaceApi;
}

export type ZoneResolver = (ctx: ZoneContext) => Promise<Zone> | Zone;

export class ZoneRegistry {
  private readonly resolvers = new Map<string, ZoneResolver>();

  register(key: string, resolver: ZoneResolver): void {
    this.resolvers.set(key, resolver);
  }

  async resolve(
    spec: ActionSpec,
    ctx: Omit<ZoneContext, "action">
  ): Promise<Zone> {
    if (!spec.dynamicZone) return spec.zone;
    const resolver = this.resolvers.get(spec.dynamicZone);
    if (!resolver) {
      // Missing resolver is a configuration error, but failing closed is safer
      // than silently downgrading a dynamic action to its static zone.
      return "red";
    }
    return resolver({ ...ctx, action: spec });
  }
}
