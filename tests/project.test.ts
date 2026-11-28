import { describe, expect, test } from "bun:test";
import { checkProject, checkRules, checkSchema } from "../scripts/validate";
import { renderProject } from "../scripts/report";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const schema = JSON.parse(readFileSync(join(import.meta.dir, "../schemas/project.schema.json"), "utf8"));

function assessment() {
  return {
    upstream: { name: "Example" },
    verdict: { recommendation: "go", summary: "Fits." },
    approach: "compatible-rewrite",
    evidence: [],
    features: [],
    dependencies: [],
    decisions: [],
    costAssumptions: [],
    capabilities: [
      { id: "state", status: "verified", decision: "reuse", upstreamEvidence: [], gaps: [], acceptanceTests: ["t.unit"], candidate: "TapeDB" },
      { id: "ldap", status: "unsupported", decision: "external", upstreamEvidence: [], gaps: [], acceptanceTests: [], candidate: "none" },
    ],
    tests: [
      { id: "t.unit", description: "unit", runtime: "workerd-local", result: "pass", ranAt: "2026-11-28" },
      { id: "t.e2e", description: "e2e", runtime: "deployed", result: "pass", ranAt: "2026-11-28", level: "e2e" },
    ],
  };
}

/** An approved project with one must, one wont, the four design diagrams and one sequence. */
function project() {
  return {
    schemaVersion: 1,
    id: "example",
    goal: "Host my repositories",
    approval: { status: "approved", by: "Brandon", at: "2026-11-28" },
    actors: [{ id: "owner", name: "Owner", description: "Owns repositories" }],
    requirements: [
      { id: "R1", title: "Create a repository", priority: "must", rationale: "Core", capabilities: ["state"], useCases: ["UC-1"] },
      { id: "R2", title: "LDAP sign-in", priority: "wont", rationale: "No LDAP on Workers", capabilities: ["ldap"], useCases: [] },
    ],
    useCases: [
      {
        id: "UC-1",
        title: "Create a repository",
        actor: "owner",
        preconditions: ["Signed in"],
        mainFlow: ["Owner names it", "System creates it"],
        acceptance: [{ criterion: "Given a name, the repository appears in the list", tests: ["t.unit", "t.e2e"] }],
      },
    ],
    diagrams: [
      { id: "context", kind: "context", file: "d.md" },
      { id: "container", kind: "container", file: "d.md" },
      { id: "data", kind: "data-model", file: "d.md" },
      { id: "deploy", kind: "deployment", file: "d.md" },
      { id: "seq", kind: "sequence", file: "d.md", covers: ["UC-1"] },
    ],
    milestones: [{ id: "M1", title: "Walking skeleton", requirements: ["R1"], status: "done" }],
    environments: [
      { name: "preview", status: "deployed", url: "https://x.workers.dev", version: "abc", deployedAt: "2026-11-28", e2eTests: ["t.e2e"] },
    ],
  };
}

const run = (p = project(), a = assessment(), dir?: string) => {
  const shape = checkSchema(p as never, schema);
  return shape.length ? shape : checkProject(p as never, a as never, dir);
};
const messages = (p = project(), a = assessment(), dir?: string) => run(p, a, dir).map((x) => x.message);

describe("project", () => {
  test("the minimal approved project passes", () => {
    expect(run()).toEqual([]);
  });

  test("diagram files must exist and hold mermaid", () => {
    const dir = mkdtempSync(join(tmpdir(), "sas-"));
    expect(messages(project(), assessment(), dir)).toContain("missing file d.md");
    writeFileSync(join(dir, "d.md"), "# no diagram\n");
    expect(messages(project(), assessment(), dir)).toContain("d.md has no mermaid block");
    writeFileSync(join(dir, "d.md"), "```mermaid\nflowchart LR\n a --> b\n```\n");
    expect(run(project(), assessment(), dir)).toEqual([]);
  });

  test("engineering cannot start without approval", () => {
    const p = project();
    p.approval = { status: "pending" } as never;
    expect(messages(p)).toContain("engineering has started (a milestone is under way or an environment is deployed) without the owner's approval");
    p.milestones[0].status = "planned";
    p.environments = [];
    expect(run(p)).toEqual([]);
  });

  test("approval needs a verdict that is not no-go", () => {
    const a = assessment() as Record<string, unknown>;
    delete a.verdict;
    expect(messages(project(), a as never)).toContain("approval needs a verdict in the assessment (verdict.recommendation)");
    a.verdict = { recommendation: "no-go", summary: "x", alternative: "a VPS" };
    expect(messages(project(), a as never)).toContain("the assessment says no-go; engineering cannot be approved against it");
  });

  test("a must cannot depend on an unsupported capability", () => {
    const p = project();
    p.requirements[1].priority = "must";
    expect(messages(p)).toContain("a must depends on ldap, which is unsupported; choose another candidate or make it wont");
  });

  test("musts need use cases, a milestone and a sequence diagram", () => {
    const p = project();
    p.requirements[0].useCases = [];
    expect(messages(p)).toContain("a must requirement needs at least one use case");
    const q = project();
    q.milestones = [];
    expect(messages(q)).toContain("a must requirement is in no milestone");
    const r = project();
    r.diagrams = r.diagrams.filter((d) => d.kind !== "sequence");
    expect(messages(r)).toContain("must use case UC-1 has no sequence diagram");
  });

  test("acceptance criteria need tests that exist", () => {
    const p = project();
    p.useCases[0].acceptance[0].tests = [];
    expect(messages(p)).toContain("an acceptance criterion needs a test");
    p.useCases[0].acceptance[0].tests = ["t.nope"];
    expect(messages(p)).toContain("unknown test t.nope");
  });

  test("a milestone is done only when its tests passed", () => {
    const a = assessment();
    a.tests[0].result = "not-run";
    expect(messages(project(), a)).toContain("done, but R1 has acceptance tests that have not passed");
  });

  test("shared environments need a go-ahead and deployed e2e tests", () => {
    const p = project();
    p.environments.push({ name: "production", status: "deployed", url: "https://x.example", version: "abc", deployedAt: "2026-11-28", e2eTests: [] } as never);
    const m = messages(p);
    expect(m).toContain("production needs the owner's go-ahead (approvedBy)");
    expect(m).toContain("a deployed environment needs e2e tests that ran against it");
    const a = assessment();
    a.tests[1].runtime = "workerd-local";
    expect(messages(project(), a)).toContain("t.e2e must have passed with runtime deployed");
  });

  test("production needs every must done", () => {
    const p = project();
    p.milestones[0].status = "in-progress";
    p.environments.push({ name: "production", status: "deployed", url: "https://x.example", version: "abc", deployedAt: "2026-11-28", approvedBy: "Brandon", e2eTests: ["t.e2e"] } as never);
    expect(run(p)).toEqual([]);
    const a = assessment();
    a.tests[0].result = "fail";
    expect(messages(p, a)).toContain("production is deployed but must R1 is not done");
    const q = project();
    q.useCases[0].acceptance[0].tests = ["t.unit"];
    q.environments = [{ name: "production", status: "deployed", url: "https://x.example", version: "abc", deployedAt: "2026-11-28", approvedBy: "Brandon", e2eTests: ["t.e2e"] }] as never;
    expect(messages(q, assessment())).toContain("production is deployed but must use case UC-1 has no test that passed deployed");
  });

  test("verdict rules", () => {
    const rules = (verdict: object, approach = "compatible-rewrite") =>
      checkRules({ ...assessment(), verdict, approach } as never).map((x) => x.message);
    expect(rules({ recommendation: "no-go", summary: "x" })).toContain("no-go names the nearest honest alternative (alternative)");
    expect(rules({ recommendation: "go", summary: "x", excluded: ["LDAP"] })).toContain("go with exclusions is go-with-exclusions");
    expect(rules({ recommendation: "go-with-exclusions", summary: "x" })).toContain("go-with-exclusions lists what is excluded");
    expect(rules({ recommendation: "go", summary: "x" }, "infeasible")).toContain("an infeasible approach is no-go");
  });

  test("delivery report shows the release gate and MoSCoW", () => {
    const text = renderProject(project(), assessment());
    expect(text).toContain("**Release gate:** 1 of 1 must requirements done; not in production");
    expect(text).toContain("| R1 | must | Create a repository | UC-1 | state (verified) | yes |");
    expect(text).toContain("- **R2 LDAP sign-in:** No LDAP on Workers");
  });
});
