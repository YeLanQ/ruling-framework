// The engine facade. All execution paths converge here; the heavy lifting is
// split into preflight (adjudication), execute (single channel), plan (advice),
// and state (knowledge/ledger persistence).

import { join } from "node:path";

import { ApprovalStore } from "./approval.js";
import { AuditLog } from "./audit.js";
import { ActionCatalog } from "./catalog.js";
import { executeRequest } from "./engine-execute.js";
import { buildPlan } from "./engine-plan.js";
import { engineStats, restoreEngine, saveEngine, type EngineStats } from "./engine-state.js";
import {
  KnowledgeStore,
  type KnowledgeConflict,
  type KnowledgeDuplicate,
  type KnowledgeKind,
  type KnowledgeQueryOptions,
  type KnowledgeStats,
  type KnowledgeStatus,
  type KnowledgeUnit
} from "./knowledge/store.js";
import { loadSeedFile } from "./knowledge/seed.js";
import { loadSynonymsFile } from "./knowledge/synonyms.js";
import {
  loadExternalSources,
  type ExternalKnowledgeConfig,
  type ExternalSourceReport
} from "./knowledge/source.js";
import { OutcomeLedger } from "./ledger.js";
import { prepareContext } from "./planner.js";
import type {
  ActionExecutor,
  ApprovalPolicy,
  ExecuteOutcome,
  ExecuteRequest,
  NormalizedTask,
  Plan,
  PreparedContext
} from "./types.js";
import { Workspace, type WorkspaceOptions } from "./workspace.js";
import { ZoneRegistry } from "./zones.js";

export interface EngineSurface {
  id: string;
  name: string;
  catalog: ActionCatalog;
  executor: ActionExecutor;
  zones: ZoneRegistry;
  /** role -> granted groups or action ids; "*" grants everything. */
  grants: Record<string, string[]>;
  defaultRole: string;
  approval: ApprovalPolicy;
  knowledge: KnowledgeStore;
}

export interface KnowledgePaths {
  dir: string;
  seedFile: string;
  synonymsFile: string;
  experienceFile: string;
  errorsFile: string;
}

export interface EngineOptions {
  workspace: WorkspaceOptions | Workspace;
  audit?: AuditLog;
  approvals?: ApprovalStore;
  ledger?: OutcomeLedger;
  knowledgePaths?: Partial<KnowledgePaths>;
  now?: () => number;
}

export class RulingEngine {
  readonly surface: EngineSurface;
  readonly workspace: Workspace;
  readonly audit: AuditLog;
  readonly approvals: ApprovalStore;
  readonly ledger: OutcomeLedger;
  readonly knowledgePaths: KnowledgePaths;
  private readonly now: () => number;

  constructor(surface: EngineSurface, options: EngineOptions) {
    this.surface = surface;
    this.workspace =
      options.workspace instanceof Workspace ? options.workspace : new Workspace(options.workspace);
    this.now = options.now ?? Date.now;
    this.audit = options.audit ?? new AuditLog({ now: this.now });
    this.approvals = options.approvals ?? new ApprovalStore(surface.approval);
    this.ledger = options.ledger ?? new OutcomeLedger();
    const defaultDir = join(this.workspace.root, ".ruling", "knowledge");
    const knowledgeDir = options.knowledgePaths?.dir ?? defaultDir;
    this.knowledgePaths = {
      dir: knowledgeDir,
      seedFile:
        options.knowledgePaths?.seedFile ?? join(knowledgeDir, "seed.json"),
      synonymsFile:
        options.knowledgePaths?.synonymsFile ?? join(knowledgeDir, "synonyms.json"),
      experienceFile:
        options.knowledgePaths?.experienceFile ?? join(knowledgeDir, "experience.jsonl"),
      errorsFile:
        options.knowledgePaths?.errorsFile ?? join(knowledgeDir, "errors.jsonl")
    };
    this.surface.knowledge.addMany(loadSeedFile(this.knowledgePaths.seedFile));
    this.surface.knowledge.setSynonyms(loadSynonymsFile(this.knowledgePaths.synonymsFile));
  }

  catalog(): ActionCatalog {
    return this.surface.catalog;
  }

  /** Human action, never a model tool. */
  approve(task: string, role?: string): void {
    this.approvals.approve(task, role ?? this.surface.defaultRole, this.now());
  }

  prepare(task: string, normalized?: NormalizedTask): PreparedContext {
    return prepareContext({
      task,
      catalog: this.surface.catalog,
      knowledge: this.surface.knowledge,
      now: this.now(),
      ...(normalized ? { normalized } : {})
    });
  }

  /**
   * Load read-only external knowledge sources into the in-memory index. Their
   * units carry an external origin and are never written to experience/errors.
   */
  async loadExternalKnowledge(
    configs: ExternalKnowledgeConfig[]
  ): Promise<ExternalSourceReport> {
    for (const config of configs) {
      this.surface.knowledge.removeByOriginPrefix(`external:${config.id}`);
    }
    const { units, report } = await loadExternalSources(configs, this.workspace.root);
    this.surface.knowledge.addMany(units);
    return report;
  }

  knowledgeUnits(
    kind?: KnowledgeKind,
    filter: { namespace?: string; domain?: string; status?: KnowledgeStatus; tag?: string } = {}
  ): KnowledgeUnit[] {
    return this.surface.knowledge.unitsByKind(kind).filter((unit) => {
      if (filter.namespace && unit.namespace !== filter.namespace) return false;
      if (filter.domain && unit.domain !== filter.domain) return false;
      if (filter.status && unit.status !== filter.status) return false;
      if (filter.tag && !unit.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  searchKnowledge(query: string, options: KnowledgeQueryOptions = {}) {
    return this.surface.knowledge.search(query, options, this.now());
  }

  knowledgeDuplicates(threshold = 0.95): KnowledgeDuplicate[] {
    return this.surface.knowledge.dedupe(threshold);
  }

  knowledgeConflicts(): KnowledgeConflict[] {
    return this.surface.knowledge.conflicts();
  }

  knowledgeStats(): KnowledgeStats {
    return this.surface.knowledge.stats();
  }

  async execute(request: ExecuteRequest): Promise<ExecuteOutcome> {
    return executeRequest(this, request, this.now);
  }

  plan(task: string, actionIds: string[]): Plan {
    return buildPlan(this, task, actionIds);
  }

  stats(): EngineStats {
    return engineStats(this);
  }

  tick(): { pruned: number; demoted: number } {
    return this.surface.knowledge.tick(this.now());
  }

  save(filePath: string): void {
    saveEngine(this, filePath, this.now());
  }

  restore(filePath: string): boolean {
    return restoreEngine(this, filePath);
  }
}
