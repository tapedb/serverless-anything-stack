import { test } from "node:test";
import { expect } from "./expect.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minimal } from "./shapes.ts";

const ROOT = join(import.meta.dirname, "..");

test("the packaged ZIP has the skill folder at its root and its scripts run from it", () => {
  execFileSync(process.execPath, [join(ROOT, "scripts/package.ts")], { encoding: "utf8" });
  const out = mkdtempSync(join(tmpdir(), "sas-unzip-"));
  execFileSync("unzip", ["-q", join(ROOT, "dist/serverless-anything-stack.zip"), "-d", out]);
  expect(readdirSync(out)).toEqual(["serverless-anything-stack"]);
  const skill = join(out, "serverless-anything-stack");
  for (const file of ["SKILL.md", "scripts/validate.ts", "scripts/report.ts", "schemas/project.schema.json", "references/engineering.md", "templates/ci.yml"]) {
    expect(existsSync(join(skill, file))).toBe(true);
  }
  for (const absent of ["tests", "node_modules", "dist", "package-lock.json"]) expect(existsSync(join(skill, absent))).toBe(false);
  expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(readFileSync(join(ROOT, "SKILL.md"), "utf8"));
  expect(JSON.parse(readFileSync(join(skill, "package.json"), "utf8")).devDependencies).toBe(undefined);

  const app = mkdtempSync(join(tmpdir(), "sas-zipapp-"));
  writeFileSync(join(app, "assessment.json"), JSON.stringify({ ...minimal(), verdict: { recommendation: "go", summary: "Fits." } }));
  const validate = spawnSync(process.execPath, [join(skill, "scripts/validate.ts"), app], { encoding: "utf8", cwd: tmpdir() });
  expect(validate.status).toBe(0);
  const report = spawnSync(process.execPath, [join(skill, "scripts/report.ts"), app], { encoding: "utf8", cwd: tmpdir() });
  expect(report.status).toBe(0);
  expect(readFileSync(join(app, "report.md"), "utf8")).toContain("## Verdict");
});
