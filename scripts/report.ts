/**
 * Renders report.md from assessment.json and, when there is a project.json,
 * delivery.md from it (requirements by MoSCoW, use cases, traceability to
 * tests, milestones, environments and the release gate).
 *
 *   bun scripts/report.ts <dir> ...          write reports (usually <app>/docs/serverless)
 *   bun scripts/report.ts --check <dir> ...  fail if a committed report is stale
 *
 * The report is generated so it cannot drift from the data the validator
 * checks. Write prose that belongs in it into the assessment.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requirementDone, requirementTests } from "./validate";

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
  if (a.verdict) {
    const label: Record<string, string> = { go: "Go", "go-with-exclusions": "Go, with exclusions", "no-go": "No-go" };
    lines.push("## Verdict", "", `**${label[a.verdict.recommendation]}.** ${a.verdict.summary}`, "");
    if (a.verdict.excluded?.length) {
      lines.push("Not built:", "");
      for (const x of a.verdict.excluded) lines.push(`- ${x}`);
      lines.push("");
    }
    if (a.verdict.alternative) lines.push(`Nearest alternative: ${a.verdict.alternative}`, "");
  }
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

const PRIORITY = ["must", "should", "could", "wont"];

export function renderProject(p: A, a: A): string {
  const tests = new Map<string, A>(a.tests.map((t: A) => [t.id, t]));
  const caps = new Map<string, A>(a.capabilities.map((c: A) => [c.id, c]));
  const testCell = (ids: string[]) =>
    ids.map((id) => {
      const t = tests.get(id);
      return t ? `${id} (${t.result}${t.result !== "not-run" ? `, ${t.runtime}` : ""})` : id;
    }).join(", ");
  const lines: string[] = [];
  lines.push(`# ${a.upstream.name}: delivery`, "");
  lines.push("Generated from `project.json` and `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.", "");
  lines.push(`- **Goal:** ${p.goal}`);
  if (p.repository) lines.push(`- **Repository:** ${p.repository}`);
  const ap = p.approval;
  lines.push(`- **Approval:** ${ap.status}${ap.by ? ` by ${ap.by}` : ""}${ap.at ? ` on ${ap.at}` : ""}${ap.notes ? `. ${ap.notes}` : ""}`);
  const musts = p.requirements.filter((r: A) => r.priority === "must");
  const done = musts.filter((r: A) => requirementDone(p as never, a as never, r.id));
  const prod = p.environments.find((e: A) => e.name === "production" && e.status === "deployed");
  lines.push(`- **Release gate:** ${done.length} of ${musts.length} must requirements done${prod ? `; production runs ${prod.version} since ${prod.deployedAt}` : "; not in production"}`, "");

  lines.push("## Requirements (MoSCoW)", "");
  lines.push("| id | priority | requirement | use cases | capabilities | done |", "| --- | --- | --- | --- | --- | --- |");
  const sorted = [...p.requirements].sort((x: A, y: A) => PRIORITY.indexOf(x.priority) - PRIORITY.indexOf(y.priority));
  for (const r of sorted) {
    const capCell = r.capabilities.map((id: string) => `${id} (${caps.get(id)?.status ?? "?"})`).join(", ");
    const isDone = r.priority === "wont" ? "n/a" : requirementDone(p as never, a as never, r.id) ? "yes" : "no";
    lines.push(`| ${r.id} | ${r.priority} | ${cell(r.title)}${r.nonFunctional ? " (non-functional)" : ""} | ${r.useCases.join(", ")} | ${cell(capCell)} | ${isDone} |`);
  }
  const wonts = sorted.filter((r: A) => r.priority === "wont");
  if (wonts.length) {
    lines.push("", "Won't, this release:", "");
    for (const r of wonts) lines.push(`- **${r.id} ${cell(r.title)}:** ${r.rationale}`);
  }

  lines.push("", "## Actors", "");
  for (const x of p.actors) lines.push(`- **${x.name}** (\`${x.id}\`): ${x.description}`);

  lines.push("", "## Use cases", "");
  for (const u of p.useCases) {
    const actor = p.actors.find((x: A) => x.id === u.actor)?.name ?? u.actor;
    lines.push(`### ${u.id}: ${u.title}`, "", `**Actor:** ${actor}`, "");
    if (u.preconditions.length) {
      lines.push("**Preconditions:**", "");
      for (const x of u.preconditions) lines.push(`- ${x}`);
      lines.push("");
    }
    lines.push("**Main flow:**", "");
    u.mainFlow.forEach((x: string, i: number) => lines.push(`${i + 1}. ${x}`));
    lines.push("");
    if (u.alternateFlows?.length) {
      lines.push("**Alternate flows:**", "");
      for (const x of u.alternateFlows) lines.push(`- ${x}`);
      lines.push("");
    }
    lines.push("| acceptance criterion | tests |", "| --- | --- |");
    for (const x of u.acceptance) lines.push(`| ${cell(x.criterion)} | ${cell(testCell(x.tests))} |`);
    lines.push("");
  }

  lines.push("## Traceability", "", "| requirement | use case | tests | passing |", "| --- | --- | --- | --- |");
  for (const r of sorted.filter((r: A) => r.priority !== "wont")) {
    for (const id of r.useCases) {
      const u = p.useCases.find((x: A) => x.id === id);
      const ids: string[] = [...new Set<string>((u?.acceptance ?? []).flatMap((x: A) => x.tests))];
      const passing = ids.filter((t) => tests.get(t)?.result === "pass").length;
      lines.push(`| ${r.id} ${r.priority} | ${id} | ${cell(ids.join(", "))} | ${passing}/${ids.length} |`);
    }
  }

  lines.push("", "## Diagrams", "");
  for (const d of p.diagrams) lines.push(`- [${d.id}](${d.file}) (${d.kind}${d.covers?.length ? `: ${d.covers.join(", ")}` : ""})`);

  lines.push("", "## Milestones", "", "| milestone | status | requirements | tests passing |", "| --- | --- | --- | --- |");
  for (const m of p.milestones) {
    const ids: string[] = [...new Set<string>(m.requirements.flatMap((r: string) => requirementTests(p as never, r)))];
    const passing = ids.filter((t) => tests.get(t)?.result === "pass").length;
    lines.push(`| ${m.id} ${cell(m.title)} | ${m.status} | ${m.requirements.join(", ")} | ${passing}/${ids.length} |`);
  }

  lines.push("", "## Environments", "", "| environment | status | url | version | since | approved by | e2e |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const e of p.environments) {
    lines.push(`| ${e.name} | ${e.status} | ${e.url ?? ""} | ${cell(e.version ?? "")} | ${e.deployedAt ?? ""} | ${cell(e.approvedBy ?? "")} | ${cell(testCell(e.e2eTests ?? []))} |`);
  }

  const open = p.requirements
    .filter((r: A) => r.priority !== "wont")
    .flatMap((r: A) => requirementTests(p as never, r.id).filter((t) => tests.get(t)?.result !== "pass").map((t) => [r, t]));
  if (open.length) {
    lines.push("", "## Open work", "", "Tests behind a requirement that have not passed, musts first:", "");
    const seen = new Set<string>();
    for (const [r, t] of open.sort((x: A, y: A) => PRIORITY.indexOf(x[0].priority) - PRIORITY.indexOf(y[0].priority))) {
      if (seen.has(t)) continue;
      seen.add(t);
      const test = tests.get(t);
      lines.push(`- \`${t}\` for ${r.id} (${r.priority}): ${test ? `${test.result}, ${test.runtime}. ${test.description}` : "unknown test"}`);
    }
  }
  return lines.join("\n") + "\n";
}

function outputs(dir: string): Array<[string, string]> {
  const source = join(dir, "assessment.json");
  if (!existsSync(source)) return [];
  const a = JSON.parse(readFileSync(source, "utf8"));
  const out: Array<[string, string]> = [[join(dir, "report.md"), render(a)]];
  const project = join(dir, "project.json");
  if (existsSync(project)) out.push([join(dir, "delivery.md"), renderProject(JSON.parse(readFileSync(project, "utf8")), a)]);
  return out;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const args = process.argv.slice(2).filter((x) => x !== "--check");
  if (args.length === 0) {
    console.log("usage: bun scripts/report.ts [--check] <app>/docs/serverless [...]");
    process.exit(2);
  }
  const dirs = args.map((x) => resolve(x));
  const show = (file: string) => file.replace(`${ROOT}/`, "");
  let stale = 0;
  for (const dir of dirs) {
    for (const [target, text] of outputs(dir)) {
      if (check) {
        if (!existsSync(target) || readFileSync(target, "utf8") !== text) {
          console.log(`stale  ${show(target)} (run bun scripts/report.ts)`);
          stale++;
        }
      } else {
        writeFileSync(target, text);
        console.log(`wrote  ${show(target)}`);
      }
    }
  }
  process.exit(stale ? 1 : 0);
}
