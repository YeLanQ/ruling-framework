// Runtime-only approval sessions. This is deliberately memory-only: persisted
// permissions rot once the granting context disappears. Nothing here is ever
// written to a snapshot or a config file.

import type { ApprovalPolicy } from "./types.js";

export interface ApprovalRecord {
  expiresAt: number;
  roles: Set<string>;
}

export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;
export const MAX_TASK_CHARS = 200;

export function normalizeTask(task: string): string {
  return task.trim().slice(0, MAX_TASK_CHARS);
}

export class ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();

  constructor(private readonly policy: ApprovalPolicy) {}

  /** A human approves the task. Approval is never exposed as a model tool. */
  approve(task: string, role: string, now = Date.now()): void {
    const key = normalizeTask(task);
    if (!key) return;
    const existing = this.records.get(key);
    const roles = existing ? existing.roles : new Set<string>();
    roles.add(role);
    this.records.set(key, {
      expiresAt: now + this.policy.ttlMs,
      roles
    });
  }

  rolesFor(task: string, now = Date.now()): string[] {
    const key = normalizeTask(task);
    const record = this.records.get(key);
    if (!record) return [];
    if (record.expiresAt <= now) {
      this.records.delete(key);
      return [];
    }
    return [...record.roles];
  }

  isApproved(task: string, group: string, now = Date.now()): boolean {
    const roles = this.rolesFor(task, now);
    if (roles.length === 0) return false;
    const required = this.policy.byGroup?.[group] ?? this.policy.defaultRoles;
    return required.every((role) => roles.includes(role));
  }

  clearExpired(now = Date.now()): number {
    let removed = 0;
    for (const [task, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(task);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.records.clear();
  }

  size(): number {
    return this.records.size;
  }
}
