/**
 * Structural public-release checks. Does not call GitHub and does not claim
 * admin settings are enabled. Prints owner/license warnings without failing
 * when those decisions are documented.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const errors = [];
const warnings = [];

function rel(path) {
  return relative(root, path) || path;
}

function mustExist(path) {
  if (!existsSync(join(root, path))) errors.push(`missing ${path}`);
}

const required = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "SUPPORT.md",
  "SECURITY.md",
  "PRIVACY.md",
  "TRADEMARKS.md",
  "THIRD_PARTY_NOTICES.md",
  "RELEASE_CHECKLIST.md",
  "docs/LEGAL.md",
  "docs/QUICKSTART.md",
  "docs/INSTALLATION.md",
  "docs/CONFIGURATION.md",
  "docs/USAGE.md",
  "docs/VOICE_MODES.md",
  "docs/VENICE_API.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY_MODEL.md",
  "docs/PRIVACY_MODEL.md",
  "docs/DEVELOPMENT.md",
  "docs/TESTING.md",
  "docs/TROUBLESHOOTING.md",
  "docs/RELEASING.md",
  "docs/GITHUB_ADMIN.md",
  "docs/BRANCH_PROTECTION.md",
  "docs/ROADMAP.md",
  "docs/assets/ember-hero.png",
  "docs/assets/ember-app.png",
  "docs/assets/ember-settings.png",
  "docs/assets/architecture.svg",
  ".github/CODEOWNERS",
  ".github/rules.json",
  ".github/dependabot.yml",
  ".github/release.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/scorecard.yml",
  ".github/workflows/docs.yml",
  ".github/workflows/release.yml",
  "scripts/github/apply-ruleset.sh",
];
for (const path of required) mustExist(path);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name === "app-builder-workspace") errors.push("package.json still uses the scaffold name");
if (pkg.private !== true)
  errors.push("package.json private flag should stay true until npm publication is requested");
if (!pkg.scripts?.["format:check"] || !pkg.scripts?.["release:check"])
  errors.push("package.json is missing format:check or release:check");

const readme = readFileSync(join(root, "README.md"), "utf8");
for (const stale of ["app-builder-workspace", "create a .env", "world's most"]) {
  if (readme.toLowerCase().includes(stale.toLowerCase()))
    errors.push(`README contains stale text: ${stale}`);
}
if (/shields\.io\/badge\/[^)]*passing/i.test(readme))
  errors.push("README contains a hardcoded passing badge");

const codeowners = readFileSync(join(root, ".github/CODEOWNERS"), "utf8").trim();
if (!codeowners) errors.push("CODEOWNERS is empty");
if (!/@[A-Za-z0-9]/.test(codeowners)) {
  warnings.push("CODEOWNERS has no GitHub owner yet (no repository remote in this workspace)");
}

const rules = JSON.parse(readFileSync(join(root, ".github/rules.json"), "utf8"));
if (!rules.name || !Array.isArray(rules.rules)) errors.push("rules.json is missing name or rules");
if (rules.enforcement !== "active") {
  warnings.push(
    `ruleset enforcement is "${rules.enforcement ?? "unset"}"; do not activate until CI check names are confirmed`,
  );
}

const legal = readFileSync(join(root, "docs/LEGAL.md"), "utf8");
if (existsSync(join(root, "LICENSE"))) {
  if (!pkg.license) warnings.push("LICENSE exists but package.json has no SPDX license field");
} else if (!/not selected/i.test(legal)) {
  errors.push("no LICENSE file and docs/LEGAL.md does not say the license is not selected");
} else {
  warnings.push("license is not selected; the project is not open source until one is");
}

if (existsSync(join(root, ".env"))) errors.push(".env exists and must not be committed");

const secretRe = [
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const skipDir = new Set([
  "node_modules",
  ".vercel",
  ".output",
  "dist",
  "coverage",
  "artifacts",
  ".git",
  "docs/assets",
  "screenshots",
]);
const textExt = new Set([
  ".md",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
  ".json",
  ".css",
  ".html",
  ".sh",
  ".svg",
  ".txt",
]);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store" || name.startsWith("._") || name === "__MACOSX") {
      errors.push(`AppleDouble or junk file: ${rel(join(dir, name))}`);
      continue;
    }
    const path = join(dir, name);
    const relPath = rel(path);
    if ([...skipDir].some((skip) => relPath === skip || relPath.startsWith(`${skip}/`))) continue;
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path);
      continue;
    }
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    if (!textExt.has(ext) || info.size > 1_500_000) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of secretRe) {
      if (pattern.test(text)) errors.push(`possible secret in ${relPath}`);
    }
  }
}
walk(root);

function parseYamlFile(path) {
  yaml.load(readFileSync(join(root, path), "utf8"));
}
for (const path of [
  ".github/dependabot.yml",
  ".github/release.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/scorecard.yml",
  ".github/workflows/docs.yml",
  ".github/workflows/release.yml",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/codeql-config.yml",
]) {
  try {
    parseYamlFile(path);
  } catch (err) {
    errors.push(`${path} failed to parse: ${err instanceof Error ? err.message : err}`);
  }
}

const workflows = readdirSync(join(root, ".github/workflows")).filter((name) =>
  name.endsWith(".yml"),
);
for (const name of workflows) {
  const text = readFileSync(join(root, ".github/workflows", name), "utf8");
  if (text.includes("pull_request_target")) errors.push(`${name} uses pull_request_target`);
  if (/permissions:\s*write-all/.test(text)) errors.push(`${name} grants write-all`);
  if (name !== "release.yml" && /contents:\s*write/.test(text))
    errors.push(`${name} grants contents: write`);
}

function localLinks(file) {
  const text = readFileSync(file, "utf8");
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = re.exec(text))) {
    const target = match[1] || match[2];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split("#")[0]?.split("?")[0] ?? "";
    if (!clean) continue;
    const dest = normalize(resolve(dirname(file), clean));
    if (!dest.startsWith(root)) errors.push(`${rel(file)} links outside the repo: ${target}`);
    else if (!existsSync(dest)) errors.push(`${rel(file)} broken local link: ${target}`);
  }
}
function walkMd(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".vercel") continue;
    const info = statSync(path);
    if (info.isDirectory()) walkMd(path);
    else if (name.endsWith(".md")) localLinks(path);
  }
}
walkMd(root);

if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  for (const warning of warnings) console.error(`warn: ${warning}`);
  process.exit(1);
}
for (const warning of warnings) console.log(`warn: ${warning}`);
console.log("release-check: structural checks passed");
