// Conversation persistence. Writes are atomic (temp file + rename), and a
// missing or corrupt document loads as empty rather than overwriting history.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ChatMessage } from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class SessionStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("会话 id 只允许字母、数字、下划线与连字符");
    return join(this.dir, `${id}.json`);
  }

  load(id: string): ChatMessage[] {
    const path = this.path(id);
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
    } catch {
      return [];
    }
  }

  save(id: string, messages: ChatMessage[]): void {
    const path = this.path(id);
    mkdirSync(this.dir, { recursive: true });
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(messages, null, 2)}\n`, "utf8");
    try {
      renameSync(temp, path);
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        // best effort
      }
      throw error;
    }
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  }
}
