import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { createEngineForPack, getPack, packIds, validatePack } from "./loader.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function engineFor(pack: string) {
  const temp = tempDir(`ruling-pack-${pack}-`);
  cleanups.push(temp.cleanup);
  const { engine } = createEngineForPack(pack, { workspace: { root: temp.path } });
  return { root: temp.path, engine };
}

describe("packs", () => {
  it("registers the three reference packs", () => {
    expect(packIds().sort()).toEqual(["industrial-design", "opc", "smb"]);
  });

  it("passes structural validation and handler coverage", () => {
    for (const id of packIds()) {
      expect(validatePack(getPack(id))).toEqual([]);
    }
  });

  it("keeps every default role inside the declared roles", () => {
    for (const id of packIds()) {
      const manifest = getPack(id).manifest;
      expect(manifest.roles).toContain(manifest.defaultRole);
    }
  });

  it("registers knowledge and failure-lesson actions in every pack", () => {
    for (const id of packIds()) {
      const manifest = getPack(id).manifest;
      for (const actionId of [
        "knowledge.add",
        "lesson.add",
        "knowledge.review",
        "knowledge.deprecate",
        "knowledge.merge"
      ]) {
        const action = manifest.actions.find((candidate) => candidate.id === actionId);
        expect(action, `${id} 缺少 ${actionId}`).toBeDefined();
        expect(action?.group).toBe("knowledge");
        expect(action?.zone).toBe("yellow");
      }
    }
  });

  it("makes irreversible OPC actions red", () => {
    const manifest = getPack("opc").manifest;
    for (const id of ["project.publish", "payment.execute", "workspace.delete"]) {
      expect(manifest.actions.find((action) => action.id === id)?.zone).toBe("red");
    }
  });

  it("upgrades a safety-critical parameter to a dynamic red line", async () => {
    const { engine } = engineFor("industrial-design");
    let created = await engine.execute({
      task: "创建设计",
      action: "design.create",
      params: { id: "bracket", name: "Bracket" },
      trust: "agent",
      source: "test"
    });
    expect(created.status).toBe("needConfirm");
    engine.approve("创建设计", "owner");
    created = await engine.execute({
      task: "创建设计",
      action: "design.create",
      params: { id: "bracket", name: "Bracket" },
      trust: "agent",
      source: "test"
    });
    expect(created.status).toBe("ok");

    engine.approve("改壁厚", "owner");
    const safety = await engine.execute({
      task: "改壁厚",
      action: "design.set_param",
      params: { id: "bracket", name: "wallThickness", value: 2 },
      trust: "agent",
      source: "test"
    });
    expect(safety.zone).toBe("red");
    expect(safety.status).toBe("denied");
  });

  it("requires reviewer and owner approvals for an SMB release preparation", async () => {
    const { engine } = engineFor("smb");
    const request = {
      task: "准备发布",
      action: "release.prepare",
      params: { version: "1.0.0" },
      trust: "agent" as const,
      source: "test" as const
    };
    const first = await engine.execute(request);
    expect(first.status).toBe("needConfirm");

    engine.approve(request.task, "reviewer");
    const afterReviewer = await engine.execute(request);
    expect(afterReviewer.status).toBe("needConfirm");

    engine.approve(request.task, "owner");
    const afterOwner = await engine.execute(request);
    expect(afterOwner.status).toBe("ok");
    expect(afterOwner.files?.[0]).toContain("release/");
  });

  it("denies SMB permission changes as red lines", async () => {
    const { engine } = engineFor("smb");
    engine.approve("授权", "owner");
    const outcome = await engine.execute({
      task: "授权",
      action: "role.grant",
      params: { user: "alice", role: "owner" },
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.errorCode).toBe("RED_LINE");
  });
});
