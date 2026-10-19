// EOL gate: every tracked text file must use LF line endings.
// Detects any CR byte (\r) — both CRLF and lone CR — across the project,
// excluding node_modules, dist and .git. Windows editors/CLIs sometimes
// write CRLF; this gate keeps the tree uniform (see .editorconfig and
// .gitattributes).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const EXCLUDE = new Set(["node_modules", "dist", ".git"]);

const files = [];

function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else files.push(full);
  }
}
collect(root);
files.sort();

let offenders = 0;
for (const file of files) {
  const bytes = readFileSync(file);
  // Skip binary files (NUL byte) — e.g. images, archives.
  if (bytes.includes(0)) continue;
  if (bytes.includes(13)) {
    offenders += 1;
    const rel = file.replace(root + "\\", "").replace(root + "/", "");
    console.error(`CRLF 行尾：${rel}`);
  }
}

if (offenders > 0) {
  console.error(`check:eol 失败：${offenders} 个文件包含 CR 行尾（应为 LF）`);
  process.exit(1);
}
console.log(`check:eol 通过（${files.length} 个文件，全部 LF）`);
