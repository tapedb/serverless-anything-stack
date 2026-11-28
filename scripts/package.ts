/**
 * Builds dist/serverless-anything-stack.zip: the skill folder as the ZIP's
 * root, with only what an agent needs at run time (no tests, no dev
 * dependencies). Upload it in Claude (Customize > Skills) or any tool that
 * takes a skill as a ZIP.
 *
 *   node scripts/package.ts
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const NAME = "serverless-anything-stack";
const INCLUDE = ["SKILL.md", "README.md", "LICENSE", "LICENSES.md", "package.json", "catalog", "docs", "recipes", "references", "schemas", "scripts", "templates"];

const stage = mkdtempSync(join(tmpdir(), "sas-pkg-"));
const folder = join(stage, NAME);
mkdirSync(folder);
for (const entry of INCLUDE) cpSync(join(ROOT, entry), join(folder, entry), { recursive: true });
// package.json without devDependencies: the run-time scripts have none.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
delete pkg.devDependencies;
pkg.scripts = { validate: pkg.scripts.validate, report: pkg.scripts.report };
writeFileSync(join(folder, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

const dist = join(ROOT, "dist");
mkdirSync(dist, { recursive: true });
const zip = join(dist, `${NAME}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-qrX", zip, NAME], { cwd: stage });
rmSync(stage, { recursive: true });
console.log(`wrote ${zip.replace(`${ROOT}/`, "")}`);
