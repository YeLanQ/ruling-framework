// End-to-end OPC demonstration. Runs without an API key: a deterministic mock
// provider stands in for the model, while every tool call still goes through
// the real adjudication engine.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockProvider, text, toolCall } from "../agent/mock-provider.js";
import { runAgent } from "../agent/loop.js";
import { createEngineForPack } from "../packs/loader.js";

function line(label: string, detail: string): void {
  process.stdout.write(`${label.padEnd(34)} ${detail}\n`);
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ruling-opc-demo-"));
  try {
    const { engine } = createEngineForPack("opc", { workspace: { root } });
    process.stdout.write("\nRuling Framework — OPC end-to-end demo\n");
    process.stdout.write(`workspace: ${root}\n\n`);

    const green = await engine.execute({
      task: "查看工作区",
      action: "workspace.list",
      trust: "agent",
      source: "test"
    });
    assert.equal(green.status, "ok");
    assert.equal(green.decision, "autoExecute");
    line("1. green read", `${green.decision} / ${green.status}`);

    const write = {
      task: "写交付说明",
      action: "doc.write",
      params: { path: "out/readme.md", content: "# Delivery\n" },
      trust: "agent" as const,
      source: "test" as const
    };
    const yellow = await engine.execute(write);
    assert.equal(yellow.status, "needConfirm");
    line("2. yellow write", `${yellow.decision} / ${yellow.status}`);

    engine.approve(write.task, "owner");
    const approved = await engine.execute(write);
    assert.equal(approved.status, "ok");
    assert.ok(existsSync(join(root, "out/readme.md")));
    line("3. after human approval", `${approved.decision} / ${approved.status}`);

    engine.approve("写交付说明", "owner");
    const unknown = await engine.execute({
      task: "写交付说明",
      action: "system.format_disk",
      trust: "agent",
      source: "test"
    });
    assert.equal(unknown.status, "needConfirm");
    line("4. unknown action (approved)", `${unknown.decision} / ${unknown.status}`);

    engine.approve("发布", "owner");
    const red = await engine.execute({
      task: "发布",
      action: "project.publish",
      trust: "agent",
      source: "test"
    });
    assert.equal(red.status, "denied");
    line("5. red action (approved)", `${red.decision} / ${red.status}`);

    const provider = new MockProvider([
      toolCall("doc_write", { path: "delivery/summary.md", content: "# Summary\n" }),
      text("已写入交付摘要。")
    ]);
    const agent = await runAgent({
      provider,
      model: "mock",
      task: "写交付摘要",
      engine,
      trust: "agent",
      role: "owner",
      onConfirm: () => true
    });
    assert.equal(agent.stoppedReason, "done");
    assert.ok(existsSync(join(root, "delivery/summary.md")));
    line("6. agent loop + approval", `${agent.stoppedReason} / ${agent.toolCalls} tool calls`);

    const chain = engine.audit.verifyChain();
    assert.equal(chain.ok, true);
    line("7. audit hash chain", `verified ${engine.audit.entries().length} entries`);

    const stats = engine.stats();
    line(
      "8. decisions",
      `auto=${stats.decisions.autoExecute} confirm=${stats.decisions.needConfirm} deny=${stats.decisions.deny}`
    );

    process.stdout.write("\nOPC demo passed.\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`OPC demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
