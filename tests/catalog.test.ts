import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "../catalog", name), "utf8"));

describe("catalogs", () => {
  test("tapedb: every entry has a status from the legend and evidence", () => {
    const catalog = load("tapedb.json");
    const statuses = Object.keys(catalog.statusMeaning);
    for (const entry of catalog.entries) {
      expect(statuses).toContain(entry.status);
      expect(entry.evidence.length).toBeGreaterThan(0);
      if (entry.status === "pending") expect(entry.pr).toMatch(/^https:\/\/github\.com\/tapedb\/tapedb\/pull\/\d+$/);
    }
    expect(new Set(catalog.entries.map((e: { id: string }) => e.id)).size).toBe(catalog.entries.length);
  });

  test("cloudflare: every entry cites a developers.cloudflare.com source and has a check date", () => {
    const catalog = load("cloudflare.json");
    expect(catalog.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const entry of catalog.entries) {
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const source of entry.sources) expect(source).toStartWith("https://developers.cloudflare.com/");
    }
  });
});

import { render } from "../scripts/report";
import { readdirSync as listCases } from "node:fs";

test("every committed report matches its assessment", () => {
  const root = join(import.meta.dir, "..", "cases");
  for (const name of listCases(root)) {
    const a = JSON.parse(readFileSync(join(root, name, "assessment.json"), "utf8"));
    expect(readFileSync(join(root, name, "report.md"), "utf8")).toBe(render(a));
  }
});
