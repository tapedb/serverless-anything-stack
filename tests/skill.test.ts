import { test } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Agents and the skills CLI parse SKILL.md frontmatter, some strictly and some
 * with their own simpler readers. The safest shape works for all of them: one
 * line per field, plain (unquoted) values, no ": " or " #" inside a value, and
 * no YAML indicator at the start.
 */
test("SKILL.md frontmatter is strict YAML with name and description", () => {
  const text = readFileSync(join(import.meta.dirname, "../SKILL.md"), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  expect(Boolean(match)).toBe(true);
  const fields: Record<string, string> = {};
  for (const line of match![1].split("\n")) {
    const at = line.indexOf(": ");
    expect(at).toBeGreaterThan(0);
    const key = line.slice(0, at);
    const raw = line.slice(at + 2).trim();
    expect(raw.length).toBeGreaterThan(0);
    expect(/: | #/.test(raw)).toBe(false);
    expect(/^[-?:,\[\]{}#&*!|>'"%@`]/.test(raw)).toBe(false);
    fields[key] = raw;
  }
  expect(fields.name).toBe("serverless-anything-stack");
  expect(fields.name).toMatch(/^[a-z0-9-]{1,64}$/);
  expect(fields.description.length).toBeGreaterThan(0);
  // Claude's skill upload allows 200 characters; the open format allows 1024.
  expect(fields.description.length <= 200).toBe(true);
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

test("SKILL.md fetches the latest version from this repository, and the fetched copy skips the fetch", () => {
  const root = join(import.meta.dirname, "..");
  const text = readFileSync(join(root, "SKILL.md"), "utf8");
  const snippet = text.match(/## First: use the latest version[\s\S]*?```sh\n([\s\S]*?)```/)?.[1];
  expect(Boolean(snippet)).toBe(true);
  const repo = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).repository.url as string;
  expect(snippet!).toContain(`git clone --quiet --depth 1 ${repo} "$dir"`);
  // The guard names the folder the snippet clones into, so the fetched copy does not fetch again.
  const folder = snippet!.match(/\/([a-z-]+)"\n/)?.[1];
  expect(folder).toBe("serverless-anything-stack-latest");
  expect(text).toContain(`already sits in a folder\nnamed \`${folder}\``);
  // Run it offline against this checkout in place of GitHub.
  const tmp = mkdtempSync(join(tmpdir(), "sas-latest-"));
  execFileSync("sh", ["-c", snippet!.replace(repo, `file://${root}`)], { env: { ...process.env, TMPDIR: tmp } });
  expect(existsSync(join(tmp, folder!, "SKILL.md"))).toBe(true);
});
