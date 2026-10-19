// End-to-end industrial-design demonstration: revisions and provenance,
// dynamic red lines for safety-critical parameters, and format locks.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEngineForPack } from "../packs/loader.js";
import type { RulingEngine } from "../core/engine.js";
import type { ExecuteOutcome, ExecuteRequest } from "../core/types.js";

function line(label: string, detail: string): void {
  process.stdout.write(`${label.padEnd(40)} ${detail}\n`);
}

async function withApproval(
  engine: RulingEngine,
  request: ExecuteRequest,
  roles: string[] = ["owner"]
): Promise<ExecuteOutcome> {
  const outcome = await engine.execute(request);
  if (outcome.status !== "needConfirm") return outcome;
  for (const role of roles) engine.approve(request.task, role);
  return engine.execute(request);
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ruling-industrial-demo-"));
  try {
    const { engine } = createEngineForPack("industrial-design", { workspace: { root } });
    process.stdout.write("\nRuling Framework — industrial design end-to-end demo\n");
    process.stdout.write(`workspace: ${root}\n\n`);

    let outcome = await withApproval(engine, {
      task: "创建设计对象",
      action: "design.create",
      params: { id: "bracket", name: "Mounting Bracket" },
      trust: "agent",
      source: "test"
    });
    assert.equal(outcome.status, "ok");
    line("1. create design (yellow)", `${outcome.decision} / ${outcome.status}`);

    outcome = await withApproval(engine, {
      task: "修改长度参数",
      action: "design.set_param",
      params: { id: "bracket", name: "length", value: 120 },
      trust: "agent",
      source: "test"
    });
    assert.equal(outcome.status, "ok");
    line("2. normal parameter (yellow)", `${outcome.decision} / ${outcome.status}`);

    engine.approve("修改安全参数", "owner");
    const safety = await engine.execute({
      task: "修改安全参数",
      action: "design.set_param",
      params: { id: "bracket", name: "wallThickness", value: 2 },
      trust: "agent",
      source: "test"
    });
    assert.equal(safety.status, "denied");
    line("3. safety-critical parameter", `${safety.decision} / ${safety.status}`);

    engine.approve("标记认证参数", "owner");
    const certified = await engine.execute({
      task: "标记认证参数",
      action: "design.set_param",
      params: { id: "bracket", name: "loadRating", value: 50, safetyCritical: true },
      trust: "agent",
      source: "test"
    });
    assert.equal(certified.status, "denied");
    line("4. certified parameter flag", `${certified.decision} / ${certified.status}`);

    const locked = await withApproval(engine, {
      task: "附加 CAD 文件",
      action: "design.attach_asset",
      params: { id: "bracket", path: "bracket.step", content: "ISO-10303-21;" },
      trust: "agent",
      source: "test"
    });
    assert.equal(locked.status, "error");
    assert.equal(locked.errorCode, "FORMAT_LOCKED");
    line("5. generic write to .step", `${locked.status} / ${locked.errorCode}`);

    outcome = await withApproval(engine, {
      task: "导入 CAD 文件",
      action: "cad.import",
      params: { id: "bracket", path: "bracket.step", content: "ISO-10303-21;" },
      trust: "agent",
      source: "test"
    });
    assert.equal(outcome.status, "ok");
    line("6. cad.import channel", `${outcome.decision} / ${outcome.status}`);

    engine.approve("发布设计", "owner");
    const release = await engine.execute({
      task: "发布设计",
      action: "design.release",
      params: { id: "bracket" },
      trust: "agent",
      source: "test"
    });
    assert.equal(release.status, "denied");
    line("7. design release (red)", `${release.decision} / ${release.status}`);

    const read = await engine.execute({
      task: "读取设计",
      action: "design.read",
      params: { id: "bracket" },
      trust: "agent",
      source: "test"
    });
    assert.equal(read.status, "ok");
    const design = read.result as { revision: number; provenance: unknown[]; files: string[] };
    assert.ok(design.provenance.length >= 3);
    assert.ok(design.files.includes("bracket.step"));
    line("8. provenance", `${design.provenance.length} entries, revision ${design.revision}`);

    const chain = engine.audit.verifyChain();
    assert.equal(chain.ok, true);
    line("9. audit hash chain", `verified ${engine.audit.entries().length} entries`);

    process.stdout.write("\nIndustrial design demo passed.\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `Industrial demo failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
