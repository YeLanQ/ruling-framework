// Core data contracts for the adjudication framework.
// The model only proposes actions; these types define what the deterministic
// core is willing to adjudicate and execute.

export type Zone = "green" | "yellow" | "red";
export type Decision = "autoExecute" | "needConfirm" | "deny";
export type TrustMode = "agent" | "operator";
export type Source = "assistant" | "cli" | "mcp" | "http" | "test";

/** Minimal JSON Schema subset used by action input validation. */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/**
 * A capability on the closed action surface. `id` is the stable contract;
 * an id that is not registered can never execute, even after approval.
 */
export interface ActionSpec {
  id: string;
  title: string;
  description: string;
  /** Deterministic words used by the brain-first planner. */
  keywords: string[];
  /** Capability group used for source-side grants. */
  group: string;
  zone: Zone;
  /** Optional dynamic zone resolver key supplied by the pack. */
  dynamicZone?: string;
  speedBudgetMs: number;
  energyWeight: number;
  inputSchema?: JsonSchema;
}

export interface ExecActor {
  id?: string;
  role?: string;
}

export interface ExecuteRequest {
  /** Truncated to 200 chars; this is the approval-session key. */
  task: string;
  action: string;
  params?: Record<string, unknown>;
  trust: TrustMode;
  actor?: ExecActor;
  source?: Source;
}

export interface ObserveReport {
  action: string;
  ok: boolean;
  ms: number;
  attempts: number;
  successes: number;
  ratio: number;
}

export interface ExecuteOutcome {
  status: "ok" | "needConfirm" | "denied" | "error";
  decision: Decision;
  zone: Zone;
  reason: string;
  ratio: number;
  result?: unknown;
  files?: string[];
  observe?: ObserveReport;
  errorCode?: RulingErrorCode;
}

export type RulingErrorCode =
  | "UNKNOWN_ACTION"
  | "ACTION_NOT_GRANTED"
  | "RED_LINE"
  | "BAD_PARAMS"
  | "PATH_INVALID"
  | "PATH_ESCAPE"
  | "INTERNAL_READONLY"
  | "FORMAT_LOCKED"
  | "SIZE_LIMIT"
  | "EXECUTOR_ERROR"
  | "INTERNAL_ERROR";

export interface ExecContext {
  task: string;
  action: string;
  params: Record<string, unknown>;
  actor: ExecActor;
  trust: TrustMode;
  source: Source;
  workspace: WorkspaceApi;
}

/** The only filesystem surface an action executor may use. */
export interface WorkspaceApi {
  readonly root: string;
  resolveSafe(rel: string): string;
  read(rel: string, maxBytes?: number): Promise<string>;
  write(rel: string, content: string, options?: { channel?: string }): Promise<void>;
  list(rel?: string): Promise<Array<{ path: string; type: "file" | "dir"; size: number }>>;
  exists(rel: string): Promise<boolean>;
  remove(rel: string): Promise<void>;
}

export interface ActionExecutor {
  execute(ctx: ExecContext): Promise<{ result?: unknown; files?: string[] }>;
  /** Used by pack validation to prove every registered action has a handler. */
  handles?(action: string): boolean;
}

export interface ApprovalPolicy {
  ttlMs: number;
  /** Roles that together satisfy a default yellow action. */
  defaultRoles: string[];
  /** Optional per-group required roles (SMB dual approval). */
  byGroup?: Record<string, string[]>;
}

export interface FormatLock {
  extensions: string[];
  channel: string;
  reason: string;
}

export interface PlanStep {
  action: string;
  zone: Zone;
  ratio: number;
  decision: Decision;
  reason: string;
}

export interface Plan {
  task: string;
  decision: Decision;
  steps: PlanStep[];
  reason: string;
}

export interface KnowledgeHit {
  id: string;
  kind: string;
  title: string;
  summary: string;
  score: number;
  namespace?: string;
  domain?: string;
  status?: string;
  confidence?: number;
}

export interface ActionCandidate {
  action: ActionSpec;
  score: number;
  source: "keyword" | "knowledge" | "graph";
}

export interface PreparedContext {
  task: string;
  segments: string[];
  candidates: ActionCandidate[];
  knowledge: KnowledgeHit[];
  /** A single high-confidence, parameterless green action can run without the LLM. */
  direct?: { action: string; params?: Record<string, unknown>; reason: string };
}
