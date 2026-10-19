export interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  const [command, ...rest] = positional;
  return { command, positional: rest, flags };
}

export const USAGE = `Ruling Framework — model proposes, system rules.

Usage:
  ruling init --pack <opc|smb|industrial-design> [--workspace .] [--trust agent|operator] [--role owner]
  ruling packs
  ruling validate --pack <id>
  ruling catalog [--pack <id>] [--json]
  ruling knowledge list [--kind seed|extended|error] [--status draft|active|deprecated] [--namespace n] [--domain d] [--tag t] [--json]
  ruling knowledge search <query> [--top 5] [--namespace n] [--domain d] [--status s] [--json]
  ruling knowledge dedupe [--threshold 0.95] [--json]
  ruling knowledge conflicts [--json]
  ruling knowledge stats [--json]
  ruling exec <action> --task <text> [--params <json>] [--role <role>] [--trust agent|operator] [--yes] [--json]
  ruling plan <action...> --task <text> [--json]
  ruling ask <task...> [--mock] [--yes] [--model <name>] [--json]
  ruling audit [verify|export] [--format md|json]
  ruling serve --http [--port 39100] [--token <token>] [--trust operator|agent]
  ruling serve --mcp [--trust operator|agent] [--role <role>]

Exit codes: 0 ok, 1 error, 2 needConfirm (no approval provided).

Approval is runtime-only. In one CLI process use --yes; for a long-running
server use HTTP POST /approve. Approval never persists across processes.
`;
