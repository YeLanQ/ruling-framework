import { describe, expect, it } from "vitest";

import { parseInlineToolCalls } from "./dialect.js";

describe("inline tool dialect", () => {
  it("parses a fenced JSON tool block", () => {
    const parsed = parseInlineToolCalls(
      '```json\n{"tool":"doc.write","arguments":{"path":"a.md","content":"x"}}\n```'
    );
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0]).toMatchObject({
      name: "doc.write",
      arguments: { path: "a.md", content: "x" }
    });
    expect(parsed.cleaned).toBe("");
    expect(parsed.broken).toBe(false);
  });

  it("parses a tool_call tag with name and parameters", () => {
    const parsed = parseInlineToolCalls(
      '<tool_call>{"name":"project.build","parameters":{"output":"dist"}}</tool_call>'
    );
    expect(parsed.calls[0]).toMatchObject({ name: "project.build", arguments: { output: "dist" } });
  });

  it("parses a named tool_call tag", () => {
    const parsed = parseInlineToolCalls('<tool_call name="doc.write">{"path":"a.md"}</tool_call>');
    expect(parsed.calls[0]).toMatchObject({ name: "doc.write", arguments: { path: "a.md" } });
  });

  it("parses an invoke/parameter structure", () => {
    const parsed = parseInlineToolCalls(
      '<invoke name="doc.write"><parameter name="path">a.md</parameter></invoke>'
    );
    expect(parsed.calls[0]).toMatchObject({ name: "doc.write", arguments: { path: "a.md" } });
  });

  it("maps wire names back to action ids", () => {
    const parsed = parseInlineToolCalls(
      '```json\n{"tool":"doc_write","arguments":{}}\n```',
      (name) => (name === "doc_write" ? "doc.write" : undefined)
    );
    expect(parsed.calls[0]?.name).toBe("doc.write");
  });

  it("strips malformed payloads without executing them", () => {
    const parsed = parseInlineToolCalls('```json\n{"tool":"doc.write", broken}\n```');
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.broken).toBe(true);
    expect(parsed.cleaned).toBe("");
  });

  it("leaves ordinary prose alone", () => {
    const parsed = parseInlineToolCalls("我会先读取文件，然后给出结论。");
    expect(parsed.calls).toHaveLength(0);
    expect(parsed.cleaned).toContain("读取文件");
  });
});
