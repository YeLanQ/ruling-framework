import { describe, expect, it } from "vitest";

import { ActionCatalog } from "./catalog.js";
import { KnowledgeStore } from "./knowledge/store.js";
import { prepareContext, segmentTask } from "./planner.js";
import type { ActionSpec } from "./types.js";

const actions: ActionSpec[] = [
  {
    id: "workspace.list",
    title: "列出工作区",
    description: "list",
    keywords: ["列出文件", "查看工作区"],
    group: "read",
    zone: "green",
    speedBudgetMs: 2000,
    energyWeight: 1
  },
  {
    id: "workspace.read",
    title: "读取文件",
    description: "read",
    keywords: ["读取文件"],
    group: "read",
    zone: "green",
    speedBudgetMs: 2000,
    energyWeight: 1,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
  },
  {
    id: "doc.write",
    title: "写入文档",
    description: "write",
    keywords: ["写文档"],
    group: "write",
    zone: "yellow",
    speedBudgetMs: 5000,
    energyWeight: 3,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    }
  }
];

const catalog = new ActionCatalog(actions);

describe("brain-first planner", () => {
  it("segments punctuation and connectors, capped at 8", () => {
    expect(segmentTask("写文档，然后构建。最后导出")).toEqual(["写文档", "构建", "导出"]);
    const long = Array.from({ length: 12 }, (_, index) => `步骤${index}`).join("，");
    expect(segmentTask(long)).toHaveLength(8);
  });

  it("routes knowledge and picks a direct green action", () => {
    const knowledge = new KnowledgeStore([
      {
        id: "seed:read",
        kind: "seed",
        title: "先读后写",
        summary: "列出目录",
        body: "列出目录与读取文件都是绿灯",
        uses: ["workspace.list"]
      }
    ]);
    const prepared = prepareContext({ task: "列出文件", catalog, knowledge });
    expect(prepared.direct?.action).toBe("workspace.list");
    expect(prepared.knowledge.length).toBeGreaterThan(0);
  });

  it("does not direct-execute a yellow action", () => {
    const knowledge = new KnowledgeStore();
    const prepared = prepareContext({ task: "写文档", catalog, knowledge });
    expect(prepared.direct).toBeUndefined();
    expect(prepared.candidates[0]?.action.id).toBe("doc.write");
  });

  it("does not direct-execute when a non-green candidate competes", () => {
    const knowledge = new KnowledgeStore();
    const prepared = prepareContext({ task: "列出文件然后写文档", catalog, knowledge });
    expect(prepared.direct).toBeUndefined();
  });

  it("does not direct-execute an action that requires parameters", () => {
    const knowledge = new KnowledgeStore();
    const prepared = prepareContext({ task: "读取文件", catalog, knowledge });
    expect(prepared.direct).toBeUndefined();
  });
});
