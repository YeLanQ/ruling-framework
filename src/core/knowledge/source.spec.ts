import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../../test-support/temp.js";
import { loadExternalSources } from "./source.js";

let temp: ReturnType<typeof tempDir> | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => {
        resolve();
      });
    });
    server = undefined;
  }
  temp?.cleanup();
  temp = undefined;
});

describe("external knowledge sources", () => {
  it("loads JSON, JSONL and Markdown with namespaced ids and origins", async () => {
    temp = tempDir("ruling-source-");
    writeFileSync(
      join(temp.path, "kb.json"),
      JSON.stringify([
        { id: "a", title: "Alpha", body: "alpha body", tags: ["one"], uses: ["doc.write"] }
      ])
    );
    writeFileSync(
      join(temp.path, "kb.jsonl"),
      `${JSON.stringify({ id: "b", title: "Beta", body: "beta body" })}\n` +
        `${JSON.stringify({ id: "c", title: "Gamma", body: "gamma body" })}\n`
    );
    const mdDir = join(temp.path, "md", "guide");
    mkdirSync(mdDir, { recursive: true });
    writeFileSync(join(mdDir, "intro.md"), "# Intro\n\nThis is the intro paragraph.\n");

    const { units, report } = await loadExternalSources(
      [
        { id: "json", type: "json", path: "kb.json", tags: ["kb"], namespace: "company", domain: "delivery", aliases: ["handbook"], confidence: 0.9 },
        { id: "jsonl", type: "jsonl", path: "kb.jsonl" },
        { id: "md", type: "markdown", dir: "md", kind: "error" }
      ],
      temp.path
    );

    expect(report.errors).toEqual([]);
    expect(report.loaded).toBe(4);
    expect(report.bySource).toEqual({ json: 1, jsonl: 2, md: 1 });

    const alpha = units.find((unit) => unit.id === "ext:json:a");
    expect(alpha).toMatchObject({
      kind: "extended",
      origin: "external:json",
      title: "Alpha",
      uses: ["doc.write"],
      namespace: "company",
      domain: "delivery",
      aliases: ["handbook"],
      confidence: 0.9
    });
    expect(alpha?.tags).toEqual(["kb", "one"]);

    const markdown = units.find((unit) => unit.id.startsWith("ext:md:"));
    expect(markdown).toMatchObject({
      kind: "error",
      title: "Intro",
      origin: "external:md"
    });
    expect(markdown?.body).toContain("This is the intro paragraph");
  });

  it("loads an HTTP JSON source", async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ units: [{ id: "remote", title: "Remote", body: "remote body" }] }));
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const { units, report } = await loadExternalSources(
      [{ id: "http", type: "http", url: `http://127.0.0.1:${port}/kb`, timeoutMs: 5000 }],
      process.cwd()
    );
    expect(report.errors).toEqual([]);
    expect(units[0]).toMatchObject({
      id: "ext:http:remote",
      title: "Remote",
      origin: "external:http"
    });
  });

  it("reports per-source errors without failing the whole load", async () => {
    temp = tempDir("ruling-source-");
    const { units, report } = await loadExternalSources(
      [
        { id: "missing", type: "json", path: "nope.json" },
        { id: "disabled", type: "json", path: "nope.json", enabled: false }
      ],
      temp.path
    );
    expect(units).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("missing");
  });
});
