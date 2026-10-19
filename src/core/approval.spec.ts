import { describe, expect, it } from "vitest";

import { ApprovalStore, MAX_TASK_CHARS } from "./approval.js";

const policy = {
  ttlMs: 1000,
  defaultRoles: ["owner"],
  byGroup: { release: ["reviewer", "owner"] }
};

describe("ApprovalStore", () => {
  it("is task-bound and expires", () => {
    const approvals = new ApprovalStore(policy);
    approvals.approve("写交付文档", "owner", 1000);
    expect(approvals.isApproved("写交付文档", "write", 1500)).toBe(true);
    expect(approvals.isApproved("另一个任务", "write", 1500)).toBe(false);
    expect(approvals.isApproved("写交付文档", "write", 2000)).toBe(false);
    expect(approvals.size()).toBe(0);
  });

  it("requires every role configured for a group", () => {
    const approvals = new ApprovalStore(policy);
    approvals.approve("准备发布", "reviewer", 1000);
    expect(approvals.isApproved("准备发布", "release", 1100)).toBe(false);
    approvals.approve("准备发布", "owner", 1100);
    expect(approvals.isApproved("准备发布", "release", 1200)).toBe(true);
    expect(approvals.rolesFor("准备发布", 1200).sort()).toEqual(["owner", "reviewer"]);
  });

  it("counts distinct roles rather than repeated approvals", () => {
    const approvals = new ApprovalStore(policy);
    approvals.approve("准备发布", "owner", 1000);
    approvals.approve("准备发布", "owner", 1010);
    expect(approvals.isApproved("准备发布", "release", 1100)).toBe(false);
  });

  it("truncates the task key to the documented limit", () => {
    const approvals = new ApprovalStore(policy);
    const long = "x".repeat(MAX_TASK_CHARS + 50);
    approvals.approve(long, "owner", 1000);
    expect(approvals.isApproved(long, "write", 1100)).toBe(true);
    expect(approvals.isApproved(long.slice(0, MAX_TASK_CHARS), "write", 1100)).toBe(true);
  });

  it("clears expired records", () => {
    const approvals = new ApprovalStore(policy);
    approvals.approve("a", "owner", 1000);
    approvals.approve("b", "owner", 1500);
    expect(approvals.clearExpired(2100)).toBe(1);
    expect(approvals.size()).toBe(1);
  });
});
