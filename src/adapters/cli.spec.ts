import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { runCli } from "./cli.js";

let temp: ReturnType<typeof tempDir> | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

async function run(args: string[], confirm = false) {
  if (!temp) temp = tempDir("ruling-cli-");
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    cwd: temp.path,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    confirm: async () => confirm
  });
  return { code, stdout, stderr };
}

describe("CLI adapter", () => {
  it("initializes a workspace with a pack", async () => {
    const result = await run(["init", "--pack", "opc"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("initialized");
    expect(existsSync(join(temp?.path ?? "", ".ruling", "config.json"))).toBe(true);
  });

  it("lists the capability surface as JSON", async () => {
    await run(["init", "--pack", "opc"]);
    const result = await run(["catalog", "--json"]);
    expect(result.code).toBe(0);
    const catalog = JSON.parse(result.stdout) as { actions: Array<{ id: string }> };
    expect(catalog.actions.some((action) => action.id === "doc.write")).toBe(true);
  });

  it("executes a green action and reports needConfirm for a yellow one", async () => {
    await run(["init", "--pack", "opc"]);
    const green = await run(["exec", "workspace.list", "--task", "查看", "--json"]);
    expect(green.code).toBe(0);
    expect(JSON.parse(green.stdout).status).toBe("ok");

    const yellow = await run([
      "exec",
      "doc.write",
      "--task",
      "写说明",
      "--params",
      JSON.stringify({ path: "a.md", content: "x" }),
      "--json"
    ]);
    expect(yellow.code).toBe(2);
    expect(JSON.parse(yellow.stdout).status).toBe("needConfirm");
  });

  it("executes a yellow action with an explicit --yes approval", async () => {
    await run(["init", "--pack", "opc"]);
    const result = await run([
      "exec",
      "doc.write",
      "--task",
      "写说明",
      "--params",
      JSON.stringify({ path: "a.md", content: "x" }),
      "--yes",
      "--json"
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("ok");
    expect(existsSync(join(temp?.path ?? "", "a.md"))).toBe(true);
  });

  it("verifies the audit chain", async () => {
    await run(["init", "--pack", "opc"]);
    await run(["exec", "workspace.list", "--task", "查看"]);
    const result = await run(["audit", "verify"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
  });

  it("validates a pack", async () => {
    const result = await run(["validate", "--pack", "industrial-design"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("lists separated knowledge libraries", async () => {
    await run(["init", "--pack", "opc"]);
    const knowledge = await run([
      "exec",
      "knowledge.add",
      "--task",
      "登记经验",
      "--params",
      JSON.stringify({ id: "exp:cli", title: "CLI 经验", body: "persisted" }),
      "--yes",
      "--json"
    ]);
    expect(knowledge.code).toBe(0);

    const lesson = await run([
      "exec",
      "lesson.add",
      "--task",
      "登记教训",
      "--params",
      JSON.stringify({ id: "lesson:cli", title: "CLI 教训", body: "avoid this" }),
      "--yes",
      "--json"
    ]);
    expect(lesson.code).toBe(0);

    const experience = await run(["knowledge", "list", "--kind", "extended", "--json"]);
    const expUnits = JSON.parse(experience.stdout) as Array<{ id: string }>;
    expect(expUnits.some((unit) => unit.id === "exp:cli")).toBe(true);

    const errors = await run(["knowledge", "list", "--kind", "error", "--json"]);
    const errUnits = JSON.parse(errors.stdout) as Array<{ id: string }>;
    expect(errUnits.some((unit) => unit.id === "lesson:cli")).toBe(true);
  });

  it("manages semantic metadata, search and lifecycle", async () => {
    await run(["init", "--pack", "opc"]);
    const add = (task: string, params: Record<string, unknown>) =>
      run([
        "exec",
        "knowledge.add",
        "--task",
        task,
        "--params",
        JSON.stringify(params),
        "--yes",
        "--json"
      ]);

    expect(
      (
        await add("登记语义经验", {
          id: "exp:semantic",
          title: "交付流程",
          body: "先写文档再构建",
          namespace: "company",
          domain: "delivery",
          aliases: ["交付物", "deliverable"],
          tags: ["workflow"],
          status: "draft",
          confidence: 0.6
        })
      ).code
    ).toBe(0);
    expect(
      (
        await add("登记重复经验", {
          id: "exp:duplicate",
          title: "交付流程",
          body: "先写文档再构建",
          namespace: "company",
          aliases: ["交付物"]
        })
      ).code
    ).toBe(0);

    const search = await run(["knowledge", "search", "交付物", "--json"]);
    const hits = JSON.parse(search.stdout) as Array<{ id: string }>;
    expect(hits.some((hit) => hit.id === "exp:semantic")).toBe(true);

    const draft = await run([
      "knowledge",
      "list",
      "--kind",
      "extended",
      "--status",
      "draft",
      "--namespace",
      "company",
      "--json"
    ]);
    expect((JSON.parse(draft.stdout) as Array<{ id: string }>).some((unit) => unit.id === "exp:semantic")).toBe(
      true
    );

    const review = await run([
      "exec",
      "knowledge.review",
      "--task",
      "审核语义经验",
      "--params",
      JSON.stringify({ id: "exp:semantic", confidence: 0.95 }),
      "--yes",
      "--json"
    ]);
    expect(review.code).toBe(0);
    const active = await run(["knowledge", "list", "--status", "active", "--json"]);
    expect((JSON.parse(active.stdout) as Array<{ id: string }>).some((unit) => unit.id === "exp:semantic")).toBe(
      true
    );

    const merge = await run([
      "exec",
      "knowledge.merge",
      "--task",
      "合并语义经验",
      "--params",
      JSON.stringify({ canonicalId: "exp:semantic", duplicateIds: ["exp:duplicate"] }),
      "--yes",
      "--json"
    ]);
    expect(merge.code).toBe(0);
    const deprecated = await run(["knowledge", "list", "--status", "deprecated", "--json"]);
    expect((JSON.parse(deprecated.stdout) as Array<{ id: string }>).some((unit) => unit.id === "exp:duplicate")).toBe(
      true
    );

    const stats = await run(["knowledge", "stats", "--json"]);
    expect(JSON.parse(stats.stdout)).toMatchObject({ total: expect.any(Number) });
    expect(JSON.parse((await run(["knowledge", "dedupe", "--json"])).stdout)).toEqual(expect.any(Array));
    expect(JSON.parse((await run(["knowledge", "conflicts", "--json"])).stdout)).toEqual(
      expect.any(Array)
    );
  });

  it("runs the direct green path in mock mode", async () => {
    await run(["init", "--pack", "opc"]);
    const result = await run(["ask", "查看工作区", "--mock", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ stoppedReason: "direct" });
  });
});
