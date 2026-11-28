import { test } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Agents and the skills CLI parse SKILL.md frontmatter with strict YAML. A
 * plain (unquoted) value may not contain ": " or " #", or start with a YAML
 * indicator; quote it with double quotes instead.
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
    let value: string;
    if (raw.startsWith('"')) value = JSON.parse(raw);
    else {
      expect(/: | #/.test(raw)).toBe(false);
      expect(/^[-?:,\[\]{}#&*!|>'"%@`]/.test(raw)).toBe(false);
      value = raw;
    }
    fields[key] = value;
  }
  expect(fields.name).toBe("serverless-anything-stack");
  expect(fields.name).toMatch(/^[a-z0-9-]{1,64}$/);
  expect(fields.description.length).toBeGreaterThan(0);
  expect(fields.description.length <= 1024).toBe(true);
});
