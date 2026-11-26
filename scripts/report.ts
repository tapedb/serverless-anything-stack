/**
 * Renders cases/<name>/report.md from cases/<name>/assessment.json.
 *
 *   bun scripts/report.ts            write every report
 *   bun scripts/report.ts --check    fail if a committed report is stale
 *
 * The report is generated so it cannot drift from the data the validator
 * checks. Write prose that belongs in it into the assessment.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

type A = Record<string, any>;

const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function render(a: A): string {
  const tests = new Map<string, A>(a.tests.map((t: A) => [t.id, t]));
  const counts: Record<string, number> = {};
  for (const c of a.capabilities) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const order = ["verified", "partial", "unverified", "unsupported", "not-applicable"];
  const lines: string[] = [];
  lines.push(`# ${a.upstream.name}: assessment`, "");
  lines.push(`Generated from \`assessment.json\` by \`bun scripts/report.ts\`. Do not edit by hand.`, "");
  lines.push(`- **Upstream:** ${a.upstream.url} at \`${a.upstream.revision}\` (inspected ${a.upstream.inspectedAt})`);
  lines.push(`- **License:** ${a.upstream.license}`);
  lines.push(`- **Approach:** ${a.approach}`);
  lines.push(`- **Capabilities:** ${order.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(", ")}`, "");
  lines.push("## Architecture", "", a.architecture.summary, "");
  lines.push("| component | primitive | responsibility |", "| --- | --- | --- |");
  for (const c of a.architecture.components) lines.push(`| ${cell(c.name)} | ${cell(c.primitive)}${c.optional ? " (optional)" : ""} | ${cell(c.responsibility)} |`);
  for (const e of a.architecture.exceptions ?? []) lines.push("", `Exception to \`${e.rule}\`: ${e.reason}`);
  lines.push("", "## Capability matrix", "");
  lines.push("| capability | status | decision | candidate | gaps | tests |", "| --- | --- | --- | --- | --- | --- |");
  const sorted = [...a.capabilities].sort((x: A, y: A) => order.indexOf(x.status) - order.indexOf(y.status));
  for (const c of sorted) {
    const ts = c.acceptanceTests.map((id: string) => {
      const t = tests.get(id);
      return t ? `${id} (${t.result}${t.result !== "not-run" ? `, ${t.runtime}` : ""})` : id;
    });
    lines.push(`| ${cell(c.description)} | ${c.status} | ${c.decision} | ${cell(c.candidate)} | ${cell(c.gaps.join(" "))} | ${cell(ts.join(", "))} |`);
  }
  lines.push("", "## Tests", "");
  const ran = a.tests.filter((t: A) => t.result !== "not-run");
  const backlog = a.tests.filter((t: A) => t.result === "not-run");
  lines.push("| test | runtime | result | ran | command |", "| --- | --- | --- | --- | --- |");
  for (const t of ran) lines.push(`| ${cell(t.description)} | ${t.runtime} | ${t.result} | ${t.ranAt ?? ""} | ${cell(t.command ? `\`${t.command}\`` : "")} |`);
  if (backlog.length) {
    lines.push("", "Not run yet (the backlog):", "");
    for (const t of backlog) lines.push(`- \`${t.id}\` (${t.runtime}): ${t.description}`);
  }
  lines.push("", "## Risks", "");
  for (const r of a.risks) lines.push(`- **${cell(r.description)}** ${cell(r.mitigation)}`);
  lines.push("", "## Decisions", "");
  for (const d of a.decisions) {
    lines.push(`### ${d.title} (${d.status})`, "", d.context, "");
    for (const o of d.options) lines.push(`- ${o.name === d.choice ? "**" + o.name + "** (chosen)" : o.name}: ${o.tradeoffs}`);
    lines.push("", d.consequences, "");
  }
  lines.push("## Cost drivers", "");
  for (const c of a.costAssumptions) lines.push(`- **${cell(c.driver)}:** ${cell(c.assumption)} (${c.source})`);
  lines.push("", "## Workload assumptions", "");
  for (const w of a.workloadAssumptions) lines.push(`- ${w}`);
  lines.push("", "## Upstream dependencies", "");
  for (const d of a.dependencies) lines.push(`- ${d.name}: ${d.role}${d.required ? "" : " (optional)"}`);
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const name of readdirSync(join(ROOT, "cases"))) {
    const source = join(ROOT, "cases", name, "assessment.json");
    if (!existsSync(source)) continue;
    const target = join(ROOT, "cases", name, "report.md");
    const text = render(JSON.parse(readFileSync(source, "utf8")));
    if (check) {
      if (!existsSync(target) || readFileSync(target, "utf8") !== text) {
        console.log(`stale  cases/${name}/report.md (run bun scripts/report.ts)`);
        stale++;
      }
    } else {
      writeFileSync(target, text);
      console.log(`wrote  cases/${name}/report.md`);
    }
  }
  process.exit(stale ? 1 : 0);
}
