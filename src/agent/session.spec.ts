import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tempDir } from "../test-support/temp.js";
import { SessionStore } from "./session.js";

let temp: ReturnType<typeof tempDir> | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

describe("SessionStore", () => {
  it("round-trips messages atomically", () => {
    temp = tempDir("ruling-session-");
    const store = new SessionStore(temp.path);
    store.save("demo", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" }
    ]);
    expect(store.load("demo")).toHaveLength(2);
    expect(store.list()).toContain("demo");
  });

  it("rejects path-like session ids", () => {
    temp = tempDir("ruling-session-");
    const store = new SessionStore(temp.path);
    expect(() => store.load("../escape")).toThrow();
    expect(() => {
      store.save("a/b", []);
    }).toThrow();
  });

  it("loads an empty history from a corrupt document", () => {
    temp = tempDir("ruling-session-");
    const store = new SessionStore(temp.path);
    writeFileSync(join(temp.path, "bad.json"), "not json", "utf8");
    expect(store.load("bad")).toEqual([]);
  });
});
