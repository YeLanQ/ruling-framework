// Incremental CHANGELOG generator.
//
// Aggregates conventional commits (feat/fix/refactor/perf/security/removed/
// breaking) that are not yet recorded into the [Unreleased] section of
// CHANGELOG.md, grouped by Keep a Changelog category. Docs/CI/chore/test
// commits are maintenance noise and skipped by default.
//
//   pnpm changelog                      # update [Unreleased] incrementally
//   pnpm changelog --release <version>  # freeze [Unreleased] as a version
//                                       # section (version + today's date)
//   pnpm changelog --dry-run            # print the resulting file without
//                                       # writing
//
// Recording boundary: the script keeps an HTML comment marker
// `<!-- last-generated: <full-sha> -->` inside the [Unreleased] section.
// When the marker is missing (first run), every commit already mentioned in
// CHANGELOG.md (backtick-wrapped hex shas) is treated as known.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(fileURLToPath(new URL("..", import.meta.url)));
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
const MARKER = /<!-- last-generated: ([0-9a-f]{40}) -->/;

const CATEGORIES = ["Added", "Fixed", "Changed", "Removed", "Security"];
const TYPE_TO_CATEGORY = {
  feat: "Added",
  fix: "Fixed",
  refactor: "Changed",
  perf: "Changed",
  security: "Security",
  removed: "Removed"
};
// Maintenance types never appear in the changelog.
const SKIPPED_TYPES = new Set(["docs", "ci", "chore", "test", "build", "revert"]);

const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release");
const version = releaseIndex >= 0 ? args[releaseIndex + 1] : null;
const dryRun = args.includes("--dry-run");
if (releaseIndex >= 0 && !version) {
  console.error("用法：node scripts/update-changelog.mjs --release <版本号>");
  process.exit(1);
}
if (version && !/^v?\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号格式非法：${version}（应为 x.y.z 或 vx.y.z）`);
  process.exit(1);
}

function git(...args) {
  return execSync(`git ${args.join(" ")}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

const changelog = readFileSync(CHANGELOG, "utf8");
const lines = changelog.split("\n");

// --- determine the commit range to consider ---
let known = new Set();
let markerSha = null;
const markerMatch = changelog.match(MARKER);
if (markerMatch) {
  markerSha = markerMatch[1];
} else {
  // First run: everything already mentioned in the file is known.
  for (const m of changelog.matchAll(/`([0-9a-f]{7,40})`/g)) {
    known.add(m[1]);
  }
}

const range = markerSha ? `${markerSha}..HEAD` : "HEAD";
const logOutput = git(`log --pretty=format:%H%x00%s%x00%b%x00 ${range}`);
const parts = logOutput.split("\x00");
const commits = [];
for (let i = 0; i + 2 < parts.length; i += 3) {
  commits.push({
    sha: parts[i].trim(),
    subject: parts[i + 1].trim(),
    body: parts[i + 2].trim()
  });
}

// --- parse conventional commits ---
const parsed = [];
for (const c of commits) {
  if (!c.sha) continue;
  const m = c.subject.match(/^([a-z]+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/);
  if (!m) continue;
  const type = m[1];
  if (SKIPPED_TYPES.has(type)) continue;
  const breaking = m[3] === "!" || /BREAKING CHANGE/i.test(c.body);
  const category = TYPE_TO_CATEGORY[type];
  if (!category) continue; // unknown type
  parsed.push({
    sha: c.sha,
    short: c.sha.slice(0, 7),
    subject: `${m[4]}${breaking ? "（破坏性变更）" : ""}`,
    category
  });
}

// Drop commits already recorded (short or full sha match).
const pending = parsed.filter((c) => {
  if (known.has(c.short) || known.has(c.sha)) return false;
  known.add(c.short);
  known.add(c.sha);
  return true;
});

// --- rebuild the [Unreleased] section ---
const headIdx = lines.findIndex((l) => l.trim() === "## [Unreleased]");
if (headIdx < 0) {
  console.error("CHANGELOG.md 缺少 [Unreleased] 节");
  process.exit(1);
}
const nextIdx = lines.findIndex((l, i) => i > headIdx && /^## \[/.test(l));
const sectionEnd = nextIdx < 0 ? lines.length : nextIdx;

// Existing entries inside [Unreleased] (skip the marker comment).
const existingSubjects = new Set();
for (let i = headIdx + 1; i < sectionEnd; i++) {
  const t = lines[i].trim();
  const em = t.match(/^- (.+?)（`[0-9a-f]{7}`）$/);
  if (em) existingSubjects.add(em[1]);
}

const grouped = {};
for (const cat of CATEGORIES) grouped[cat] = [];
for (const c of pending) {
  if (existingSubjects.has(c.subject)) continue;
  grouped[c.category].push(c);
}

// Compose new section body.
const body = ["## [Unreleased]"];
const hasAny = Object.values(grouped).some((arr) => arr.length > 0);
const headSha = git("rev-parse HEAD");
if (hasAny) {
  for (const cat of CATEGORIES) {
    if (grouped[cat].length === 0) continue;
    body.push("");
    body.push(`### ${cat}`);
    for (const c of grouped[cat]) body.push(`- ${c.subject}（\`${c.short}\`）`);
  }
}
body.push("");
body.push(`<!-- last-generated: ${headSha} -->`);

const newSection = body.join("\n");
const updated = [...lines.slice(0, headIdx), newSection, ...lines.slice(sectionEnd)].join("\n");

function freeze(current) {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const cleanVersion = version.replace(/^v/, "");
  const headSha = git("rev-parse HEAD");
  // Entries inside [Unreleased] (everything before the marker comment).
  const markerIdx = body.findIndex((l) => l.startsWith("<!-- last-generated:"));
  const entries = body.slice(1, markerIdx);
  while (entries.length && entries[entries.length - 1].trim() === "") entries.pop();
  const frozenLines = [...lines.slice(0, headIdx), `## [${cleanVersion}] - ${date}`];
  if (entries.length) frozenLines.push("", ...entries);
  frozenLines.push("", "## [Unreleased]", "", `<!-- last-generated: ${headSha} -->`, "");
  return {
    frozen: [...frozenLines, ...lines.slice(sectionEnd)].join("\n"),
    cleanVersion,
    date
  };
}

if (version) {
  const { frozen, cleanVersion, date } = freeze(updated);
  if (dryRun) {
    console.log(frozen);
  } else {
    writeFileSync(CHANGELOG, frozen);
    console.log(`已固化 [Unreleased] 为 [${cleanVersion}] - ${date}。`);
    console.log(`提醒：请同步 package.json 的 version，并可按需打 tag v${cleanVersion}。`);
  }
} else if (dryRun) {
  console.log(newSection);
} else if (pending.length === 0) {
  console.log("无未收录的显著提交，[Unreleased] 保持不变。");
} else {
  writeFileSync(CHANGELOG, updated);
  console.log(`已向 [Unreleased] 追加 ${pending.length} 条（${pending.map((c) => c.short).join(", ")}）。`);
}
