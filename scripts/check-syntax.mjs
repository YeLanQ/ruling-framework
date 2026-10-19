// Syntax gate: parse every src/**/*.ts with the TypeScript compiler in
// transpile-only mode. Catches parse errors without the cost of a full
// type-check; the type gate (tsc --noEmit) runs separately.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..", "src");
const files = [];

function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
}
collect(root);
files.sort();

let errors = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext
    }
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    errors += 1;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    console.error(`syntax error ${file}: ${message}`);
  }
}

if (errors > 0) {
  console.error(`check:syntax 失败：${errors} 个语法错误`);
  process.exit(1);
}
console.log(`check:syntax 通过（${files.length} 个文件）`);
