import { test } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { parse as parseYaml } from "yaml";

const templates = join(import.meta.dirname, "../templates");

test("every mermaid diagram in templates/diagrams.md parses", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Element: dom.window.Element });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false });
  const text = readFileSync(join(templates, "diagrams.md"), "utf8");
  const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  expect(blocks.length).toBeGreaterThan(5);
  const kinds: string[] = [];
  for (const block of blocks) kinds.push((await mermaid.parse(block) as { diagramType: string }).diagramType);
  for (const kind of ["flowchart-v2", "er", "sequence", "stateDiagram"]) expect(kinds).toContain(kind);
});

test("templates/ci.yml is a workflow whose jobs and needs line up", () => {
  const wf = parseYaml(readFileSync(join(templates, "ci.yml"), "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { "runs-on": string; needs?: string | string[]; steps: Array<{ uses?: string; run?: string }> }>;
  };
  expect(Object.keys(wf.on)).toContain("workflow_dispatch");
  const jobs = Object.keys(wf.jobs);
  for (const name of ["test", "preview", "staging", "production"]) expect(jobs).toContain(name);
  for (const [name, job] of Object.entries(wf.jobs)) {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.steps.length).toBeGreaterThan(0);
    for (const need of [job.needs ?? []].flat()) expect(jobs).toContain(need);
    for (const step of job.steps) expect(Boolean(step.uses || step.run)).toBe(true);
    if (name !== "test") expect([job.needs].flat()).toContain("test");
  }
  expect((wf.jobs.production as unknown as { environment: string }).environment).toBe("production");
});
