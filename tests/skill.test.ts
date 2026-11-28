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
  expect(fields.description.length <= 1024).toBe(true);
});
