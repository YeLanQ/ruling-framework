import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineForPack } from "../packs/loader.js";
import { tempDir } from "../test-support/temp.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function opc() {
  const temp = tempDir("ruling-engine-");
  cleanups.push(temp.cleanup);
  const { engine } = createEngineForPack("opc", { workspace: { root: temp.path } });
  return { root: temp.path, engine };
}

const write = {
  action: "doc.write",
  params: { path: "out/readme.md", content: "# hi\n" },
  trust: "agent" as const,
  source: "test" as const
};

describe("RulingEngine", () => {
  it("auto-executes green reads", async () => {
    const { engine } = opc();
    const outcome = await engine.execute({ task: "查看", action: "workspace.list", trust: "agent", source: "test" });
    expect(outcome.status).toBe("ok");
    expect(outcome.decision).toBe("autoExecute");
    expect(outcome.zone).toBe("green");
  });

  it("requires approval for yellow writes and executes after it", async () => {
    const { root, engine } = opc();
    const first = await engine.execute({ task: "写说明", ...write });
    expect(first.status).toBe("needConfirm");
    engine.approve("写说明", "owner");
    const second = await engine.execute({ task: "写说明", ...write });
    expect(second.status).toBe("ok");
    expect(second.files).toEqual(["out/readme.md"]);
    expect(readFileSync(join(root, "out/readme.md"), "utf8")).toBe("# hi\n");
  });

  it("never executes an unregistered action, even after approval", async () => {
    const { engine } = opc();
    engine.approve("写说明", "owner");
    const outcome = await engine.execute({
      task: "写说明",
      action: "system.format_disk",
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("needConfirm");
    expect(outcome.errorCode).toBe("UNKNOWN_ACTION");
  });

  it("denies red actions even after approval", async () => {
    const { engine } = opc();
    engine.approve("发布", "owner");
    const outcome = await engine.execute({
      task: "发布",
      action: "project.publish",
      trust: "agent",
      source: "test"
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.errorCode).toBe("RED_LINE");
  });

  it("operator trust bypasses the three-zone approval but not red lines", async () => {
    const { engine } = opc();
    const allowed = await engine.execute({
      task: "写说明",
      action: "doc.write",
      params: write.params,
      trust: "operator",
      source: "test"
    });
    expect(allowed.status).toBe("ok");
    const denied = await engine.execute({
      task: "发布",
      action: "project.publish",
      trust: "operator",
      source: "test"
    });
    expect(denied.status).toBe("denied");
    expect(denied.errorCode).toBe("RED_LINE");
  });

  it("rejects unknown actions for operator trust", async () => {
    const { engine } = opc();
    const outcome = await engine.execute({
      task: "未知",
      action: "system.format_disk",
      trust: "operator",
      source: "test"
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.errorCode).toBe("UNKNOWN_ACTION");
  });

  it("rejects structurally wrong parameters before execution", async () => {
    const { engine } = opc();
    const outcome = await engine.execute({
      task: "写说明",
      action: "doc.write",
      params: { path: "out/readme.md" },
      trust: "operator",
      source: "test"
    });
    expect(outcome.status).toBe("error");
    expect(outcome.errorCode).toBe("BAD_PARAMS");
  });

  it("enforces role grants at the source", async () => {
    const temp = tempDir("ruling-engine-smb-");
    cleanups.push(temp.cleanup);
    const { engine } = createEngineForPack("smb", { workspace: { root: temp.path } });
    const outcome = await engine.execute({
      task: "写说明",
      action: "doc.write",
      params: write.params,
      trust: "operator",
      actor: { role: "viewer" },
      source: "test"
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.errorCode).toBe("ACTION_NOT_GRANTED");
  });

  it("makes plan-level recommendations without overriding single calls", () => {
    const { engine } = opc();
    expect(engine.plan("读", ["workspace.list", "workspace.read"]).decision).toBe("autoExecute");
    expect(engine.plan("写", ["workspace.list", "doc.write"]).decision).toBe("needConfirm");
    expect(engine.plan("发布", ["project.publish"]).decision).toBe("deny");
  });

  it("persists knowledge and ledger but never approvals", async () => {
    const { root, engine } = opc();
    const stateFile = join(root, ".ruling-state.json.gz");
    engine.approve("写说明", "owner");
    engine.save(stateFile);

    const restored = createEngineForPack("opc", { workspace: { root } }).engine;
    restored.restore(stateFile);
    expect(restored.approvals.size()).toBe(0);

    const outcome = await restored.execute({ task: "写说明", ...write });
    expect(outcome.status).toBe("needConfirm");

    const raw = gunzipSync(readFileSync(stateFile)).toString("utf8");
    expect(raw).not.toContain("approvals");
    expect(raw).not.toContain("roles");
  });

  it("rejects invalid trust modes and non-object params at runtime", async () => {
    const { engine } = opc();
    await expect(
      engine.execute({
        task: "x",
        action: "workspace.list",
        trust: "bogus" as never,
        source: "test"
      })
    ).rejects.toThrow("trust");
    await expect(
      engine.execute({
        task: "x",
        action: "workspace.list",
        params: [] as never,
        trust: "agent",
        source: "test"
      })
    ).rejects.toThrow("params");
  });

  it("writes a verifiable audit chain", async () => {
    const { engine } = opc();
    await engine.execute({ task: "查看", action: "workspace.list", trust: "agent", source: "test" });
    await engine.execute({ task: "写", ...write });
    expect(engine.audit.verifyChain()).toEqual({ ok: true });
  });
});
