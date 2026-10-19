// Data-boundary enforcement (the framework's G3): every executor reaches the
// workspace through this class. Paths are relative, traversal is rejected,
// internal/ is read-only, engine-managed formats are locked to their channel,
// and writes have a hard size limit.

import { randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";

import type { FormatLock, RulingErrorCode, WorkspaceApi } from "./types.js";

export interface WorkspaceOptions {
  root: string;
  maxWriteBytes?: number;
  maxReadBytes?: number;
  formatLocks?: FormatLock[];
  internalDir?: string;
}

export class WorkspaceError extends Error {
  constructor(
    readonly code: RulingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class Workspace implements WorkspaceApi {
  readonly root: string;
  private readonly maxWriteBytes: number;
  private readonly maxReadBytes: number;
  private readonly formatLocks: FormatLock[];
  private readonly internalDir: string;

  constructor(options: WorkspaceOptions) {
    this.root = resolve(options.root);
    this.maxWriteBytes = options.maxWriteBytes ?? 512 * 1024;
    this.maxReadBytes = options.maxReadBytes ?? 2 * 1024 * 1024;
    this.formatLocks = options.formatLocks ?? [];
    this.internalDir = options.internalDir ?? "internal";
  }

  resolveSafe(rel: string): string {
    const raw = rel.trim();
    if (!raw || raw === ".") return this.root;
    if (raw.includes("\0")) throw new WorkspaceError("PATH_INVALID", "路径包含非法字符");
    if (raw.includes("\\")) throw new WorkspaceError("PATH_INVALID", "工作区路径必须使用 / 分隔符");
    // `isAbsolute` only recognizes POSIX `/`-rooted paths on Linux/macOS, so a
    // Windows drive-letter path like `C:/temp/x.txt` would slip through on CI.
    // Reject the drive-letter form on every platform to keep the data boundary
    // independent of the host OS.
    if (/^[a-zA-Z]:[\\/]/.test(raw)) {
      throw new WorkspaceError("PATH_INVALID", "工作区路径必须为相对路径");
    }
    if (isAbsolute(raw)) throw new WorkspaceError("PATH_INVALID", "工作区路径必须为相对路径");
    const parts = raw.split("/");
    if (parts.some((part) => part === "..")) {
      throw new WorkspaceError("PATH_ESCAPE", "路径不得包含 ..");
    }
    const abs = resolve(this.root, raw);
    const prefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (abs !== this.root && !abs.startsWith(prefix)) {
      throw new WorkspaceError("PATH_ESCAPE", "路径越出工作区");
    }
    return abs;
  }

  private assertWritable(rel: string, channel?: string): void {
    const normalized = rel.replace(/^\/+/, "");
    if (normalized === this.internalDir || normalized.startsWith(`${this.internalDir}/`)) {
      throw new WorkspaceError("INTERNAL_READONLY", `${this.internalDir}/ 为只读目录`);
    }
    const ext = extname(rel).toLowerCase();
    for (const lock of this.formatLocks) {
      if (!lock.extensions.includes(ext)) continue;
      if (channel === lock.channel) continue;
      throw new WorkspaceError(
        "FORMAT_LOCKED",
        `${ext} 由 ${lock.channel} 通道管理：${lock.reason}`
      );
    }
  }

  async read(rel: string, maxBytes = this.maxReadBytes): Promise<string> {
    const abs = this.resolveSafe(rel);
    const info = await stat(abs);
    if (info.size > maxBytes) {
      throw new WorkspaceError("SIZE_LIMIT", `读取超过 ${maxBytes} 字节上限`);
    }
    return readFile(abs, "utf8");
  }

  async write(rel: string, content: string, options?: { channel?: string }): Promise<void> {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.maxWriteBytes) {
      throw new WorkspaceError("SIZE_LIMIT", `写入超过 ${this.maxWriteBytes} 字节上限`);
    }
    this.assertWritable(rel, options?.channel);
    const abs = this.resolveSafe(rel);
    if (abs === this.root) throw new WorkspaceError("PATH_INVALID", "不能写入工作区根目录");
    await mkdir(resolve(abs, ".."), { recursive: true });
    const temp = `${abs}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(temp, content, "utf8");
      await rename(temp, abs);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async list(rel = "."): Promise<Array<{ path: string; type: "file" | "dir"; size: number }>> {
    const abs = this.resolveSafe(rel);
    const entries = await readdir(abs, { withFileTypes: true });
    const out: Array<{ path: string; type: "file" | "dir"; size: number }> = [];
    for (const entry of entries) {
      const childRel = rel === "." ? entry.name : `${rel.replace(/\/+$/, "")}/${entry.name}`;
      const info = entry.isDirectory() ? undefined : await stat(resolve(abs, entry.name));
      out.push({
        path: childRel,
        type: entry.isDirectory() ? "dir" : "file",
        size: info?.size ?? 0
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await access(this.resolveSafe(rel));
      return true;
    } catch {
      return false;
    }
  }

  async remove(rel: string): Promise<void> {
    this.assertWritable(rel);
    const abs = this.resolveSafe(rel);
    if (abs === this.root) throw new WorkspaceError("PATH_INVALID", "不能删除工作区根目录");
    await rm(abs, { recursive: true, force: true });
  }
}
