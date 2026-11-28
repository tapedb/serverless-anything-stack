/**
 * Validates an application's assessment.json against the schemas in
 * schemas/ and against the rules a schema cannot state:
 *
 * - every evidence, test and capability reference resolves;
 * - `verified` needs upstream evidence, candidate evidence, and at least one
 *   acceptance test that passed; `deployed` in a claim needs a deployed test;
 * - `partial` names its gaps; `unsupported` is never `reuse`; `not-applicable`
 *   is `exclude`;
 * - a decision's choice is one of its options;
 * - a verified capability's candidate evidence was checked at a date, and
 *   tests that passed say when.
 *
 * and, when a project.json sits next to the assessment, the delivery rules in
 * checkProject: MoSCoW requirements trace to use cases, use cases to tests,
 * engineering waits for the owner's approval, finished milestones and deployed
 * environments are backed by passing tests.
 *
 * No dependencies: the schema checker below implements the JSON Schema subset
 * these schemas use (type, enum, const, required, properties,
 * additionalProperties: false, items, minItems, minLength, pattern, $ref).
 *
 *   bun scripts/validate.ts <dir-or-assessment.json> ...
 *     (a directory, usually <app>/docs/serverless, means its assessment.json
 *     and, if present, its project.json)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = Record<string, unknown>;

const ROOT = resolve(import.meta.dir, "..");
const SCHEMAS: Record<string, Schema> = Object.fromEntries(
  readdirSync(join(ROOT, "schemas")).map((file) => [file, JSON.parse(readFileSync(join(ROOT, "schemas", file), "utf8")) as Schema])
);

export interface Problem {
  path: string;
  message: string;
}

function typeOf(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** The schema subset these files use. */
export function checkSchema(value: Json, schema: Schema, path = "$", problems: Problem[] = []): Problem[] {
  if (typeof schema.$ref === "string") {
    const target = SCHEMAS[schema.$ref];
    if (!target) problems.push({ path, message: `unknown $ref ${schema.$ref}` });
    else checkSchema(value, target, path, problems);
    return problems;
  }
  if ("const" in schema && value !== schema.const) problems.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    problems.push({ path, message: `must be one of ${schema.enum.join(", ")}, not ${JSON.stringify(value)}` });
  }
  const type = schema.type as string | undefined;
  if (type) {
    const actual = typeOf(value);
    const ok = actual === type || (type === "number" && actual === "integer");
    if (!ok) {
      problems.push({ path, message: `must be ${type}, not ${actual}` });
      return problems;
    }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) problems.push({ path, message: "must not be empty" });
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) problems.push({ path, message: `must match ${schema.pattern}` });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) problems.push({ path, message: `needs at least ${schema.minItems} items` });
    if (schema.items) value.forEach((item, index) => checkSchema(item, schema.items as Schema, `${path}[${index}]`, problems));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in value)) problems.push({ path, message: `missing ${key}` });
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) checkSchema(child, properties[key], `${path}.${key}`, problems);
      else if (schema.additionalProperties === false) problems.push({ path, message: `unknown property ${key}` });
    }
  }
  return problems;
}

type Assessment = {
  evidence: Array<{ id: string; kind: string; checkedAt?: string }>;
  features: Array<{ id: string; evidence: string[]; capabilities?: string[] }>;
  dependencies: Array<{ name: string; evidence: string[] }>;
  capabilities: Array<{
    id: string;
    status: string;
    decision: string;
    upstreamEvidence: string[];
    candidateEvidence?: string[];
    gaps: string[];
    acceptanceTests: string[];
    candidate: string;
  }>;
  decisions: Array<{ id: string; choice: string; options: Array<{ name: string }>; evidence?: string[] }>;
  tests: Array<{ id: string; runtime: string; result: string; ranAt?: string; evidence?: string[] }>;
  costAssumptions: Array<{ driver: string; source: string }>;
};

/** The rules a schema cannot state. */
export function checkRules(assessment: Assessment): Problem[] {
  const problems: Problem[] = [];
  const evidence = new Map(assessment.evidence.map((item) => [item.id, item]));
  const tests = new Map(assessment.tests.map((test) => [test.id, test]));
  const capabilities = new Set(assessment.capabilities.map((capability) => capability.id));
  const unique = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push({ path: what, message: `duplicate id ${id}` });
      seen.add(id);
    }
  };
  unique(assessment.evidence.map((item) => item.id), "$.evidence");
  unique(assessment.tests.map((test) => test.id), "$.tests");
  unique(assessment.capabilities.map((capability) => capability.id), "$.capabilities");
  unique(assessment.features.map((feature) => feature.id), "$.features");

  const resolves = (ids: string[] | undefined, path: string) => {
    for (const id of ids ?? []) if (!evidence.has(id)) problems.push({ path, message: `unknown evidence ${id}` });
  };
  for (const feature of assessment.features) {
    resolves(feature.evidence, `$.features.${feature.id}`);
    if (feature.evidence.length === 0) problems.push({ path: `$.features.${feature.id}`, message: "a feature needs upstream evidence" });
    for (const id of feature.capabilities ?? []) {
      if (!capabilities.has(id)) problems.push({ path: `$.features.${feature.id}`, message: `unknown capability ${id}` });
    }
  }
  for (const dependency of assessment.dependencies) resolves(dependency.evidence, `$.dependencies.${dependency.name}`);
  for (const decision of assessment.decisions) {
    resolves(decision.evidence, `$.decisions.${decision.id}`);
    if (!decision.options.some((option) => option.name === decision.choice)) {
      problems.push({ path: `$.decisions.${decision.id}`, message: `choice "${decision.choice}" is not one of its options` });
    }
  }
  for (const cost of assessment.costAssumptions) {
    if (cost.source !== "UNPRICED") {
      const item = evidence.get(cost.source);
      if (!item) problems.push({ path: `$.costAssumptions.${cost.driver}`, message: `unknown evidence ${cost.source}` });
      else if (item.kind !== "pricing") problems.push({ path: `$.costAssumptions.${cost.driver}`, message: `${cost.source} is not pricing evidence` });
    }
  }
  const verdict = (assessment as Assessment & { verdict?: { recommendation: string; excluded?: string[]; alternative?: string }; approach?: string }).verdict;
  const approach = (assessment as { approach?: string }).approach;
  if (verdict) {
    if (verdict.recommendation === "no-go" && !verdict.alternative) problems.push({ path: "$.verdict", message: "no-go names the nearest honest alternative (alternative)" });
    if (verdict.recommendation === "go" && (verdict.excluded ?? []).length > 0) problems.push({ path: "$.verdict", message: "go with exclusions is go-with-exclusions" });
    if (verdict.recommendation === "go-with-exclusions" && (verdict.excluded ?? []).length === 0) problems.push({ path: "$.verdict", message: "go-with-exclusions lists what is excluded" });
    if (approach === "infeasible" && verdict.recommendation !== "no-go") problems.push({ path: "$.verdict", message: "an infeasible approach is no-go" });
    if (approach === "undecided") problems.push({ path: "$.verdict", message: "a verdict needs a decided approach" });
  }
  for (const test of assessment.tests) {
    resolves(test.evidence, `$.tests.${test.id}`);
    if (test.result !== "not-run" && !test.ranAt) problems.push({ path: `$.tests.${test.id}`, message: "a test that ran says when (ranAt)" });
  }

  for (const capability of assessment.capabilities) {
    const path = `$.capabilities.${capability.id}`;
    resolves(capability.upstreamEvidence, path);
    resolves(capability.candidateEvidence, path);
    for (const id of capability.acceptanceTests) if (!tests.has(id)) problems.push({ path, message: `unknown test ${id}` });
    const passed = capability.acceptanceTests.map((id) => tests.get(id)).filter((test) => test?.result === "pass");

    switch (capability.status) {
      case "verified":
        if (capability.upstreamEvidence.length === 0) problems.push({ path, message: "verified needs upstream evidence" });
        if ((capability.candidateEvidence ?? []).length === 0) problems.push({ path, message: "verified needs evidence for the candidate" });
        if (passed.length === 0) problems.push({ path, message: "verified needs an acceptance test that passed" });
        for (const id of capability.candidateEvidence ?? []) {
          const item = evidence.get(id);
          if (item && !item.checkedAt) problems.push({ path, message: `evidence ${id} behind a verified claim needs checkedAt` });
        }
        if (capability.gaps.length > 0 && capability.decision === "reuse") {
          problems.push({ path, message: "verified with gaps is partial, not verified" });
        }
        break;
      case "partial":
        if (capability.gaps.length === 0) problems.push({ path, message: "partial must name its gaps" });
        break;
      case "unsupported":
        if (capability.decision === "reuse") problems.push({ path, message: "an unsupported capability cannot be reused" });
        break;
      case "not-applicable":
        if (capability.decision !== "exclude") problems.push({ path, message: "not-applicable is excluded" });
        break;
    }
    if (/\bdeployed\b/i.test(capability.candidate) && capability.status === "verified") {
      if (!passed.some((test) => test?.runtime === "deployed")) {
        problems.push({ path, message: "a candidate described as deployed needs a deployed test that passed" });
      }
    }
  }
  return problems;
}

/**
 * Architecture rules from the handoff's skill-evaluation gate. Each names a
 * mistake that duplicates a primitive the stack already has, or puts a workload
 * where it does not fit. A design may break one on purpose by recording it in
 * architecture.exceptions with its reason and evidence.
 */
export function checkArchitecture(assessment: Assessment): Problem[] {
  const problems: Problem[] = [];
  const architecture = assessment.architecture as Assessment["architecture"] & {
    exceptions?: Array<{ rule: string; reason: string; evidence: string[] }>;
  };
  const components = architecture.components as Array<{ name: string; primitive: string; responsibility: string; optional?: boolean }>;
  const waived = new Set((architecture.exceptions ?? []).map((e) => e.rule));
  const evidence = new Set(assessment.evidence.map((e) => e.id));
  for (const e of architecture.exceptions ?? []) {
    for (const id of e.evidence) if (!evidence.has(id)) problems.push({ path: `$.architecture.exceptions.${e.rule}`, message: `unknown evidence ${id}` });
  }
  const uses = (pattern: RegExp) => components.filter((c) => pattern.test(c.primitive));
  const reused = assessment.capabilities.filter((c) => c.decision === "reuse" && /tapedb/i.test(c.candidate));

  const tapedbLive = uses(/tapedb[^,;]*(live|presence|broadcast)/i).length > 0 || reused.some((c) => c.workload === "realtime");
  const otherSockets = uses(/websocket|socket\.io|actioncable|pusher|ably/i).filter((c) => !/tapedb/i.test(c.primitive));
  if (tapedbLive && otherSockets.length > 0 && !waived.has("second-socket")) {
    problems.push({ path: "$.architecture", message: `second-socket: ${otherSockets.map((c) => c.name).join(", ")} adds a socket service next to TapeDB live queries` });
  }

  const tapedbWebhooks = uses(/tapedb[^,;]*webhook/i).length > 0 || reused.some((c) => /tapedb webhooks/i.test(c.candidate));
  const otherOutbox = uses(/outbox/i).filter((c) => !/tapedb|client outbox/i.test(c.primitive));
  if (tapedbWebhooks && otherOutbox.length > 0 && !waived.has("second-outbox")) {
    problems.push({ path: "$.architecture", message: `second-outbox: ${otherOutbox.map((c) => c.name).join(", ")} adds an outbox next to TapeDB webhooks` });
  }

  const kv = uses(/\bkv\b|workers kv/i).filter((c) => !c.optional);
  if (kv.length > 0 && !waived.has("mandatory-kv")) {
    problems.push({ path: "$.architecture", message: `mandatory-kv: ${kv.map((c) => c.name).join(", ")} is KV without optional: true; justify it in architecture.exceptions or make it optional` });
  }

  const warehouse = assessment.capabilities.filter((c) => c.workload === "ingestion" && c.decision === "reuse" && /tapedb/i.test(c.candidate));
  if (warehouse.length > 0 && !waived.has("telemetry-in-tapedb")) {
    problems.push({ path: "$.capabilities", message: `telemetry-in-tapedb: ${warehouse.map((c) => c.id).join(", ")} puts an ingestion workload in TapeDB, which is not a telemetry store` });
  }
  return problems;
}

type Project = {
  approval: { status: string; by?: string; at?: string };
  actors: Array<{ id: string }>;
  requirements: Array<{ id: string; title: string; priority: string; capabilities: string[]; useCases: string[] }>;
  useCases: Array<{ id: string; actor: string; acceptance: Array<{ criterion: string; tests: string[] }> }>;
  diagrams: Array<{ id: string; kind: string; file: string; covers?: string[] }>;
  milestones: Array<{ id: string; requirements: string[]; status: string }>;
  environments: Array<{ name: string; status: string; approvedBy?: string; deployedAt?: string; version?: string; e2eTests?: string[] }>;
};

/** Test ids behind a requirement: every acceptance test of every use case it names. */
export function requirementTests(project: Project, requirementId: string): string[] {
  const requirement = project.requirements.find((r) => r.id === requirementId);
  if (!requirement) return [];
  const cases = project.useCases.filter((u) => requirement.useCases.includes(u.id));
  return [...new Set(cases.flatMap((u) => u.acceptance.flatMap((a) => a.tests)))];
}

/** A requirement is done when it has tests and every one of them passed. */
export function requirementDone(project: Project, assessment: Pick<Assessment, "tests">, requirementId: string): boolean {
  const tests = new Map(assessment.tests.map((t) => [t.id, t]));
  const ids = requirementTests(project, requirementId);
  return ids.length > 0 && ids.every((id) => tests.get(id)?.result === "pass");
}

/**
 * Delivery rules. `baseDir` is the directory of project.json; diagram files
 * are checked there when it is given.
 */
export function checkProject(project: Project, assessment: Assessment & { verdict?: { recommendation: string } }, baseDir?: string): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  const tests = new Map(assessment.tests.map((t) => [t.id, t]));
  const capabilities = new Map(assessment.capabilities.map((c) => [c.id, c]));
  const actors = new Set(project.actors.map((a) => a.id));
  const useCases = new Map(project.useCases.map((u) => [u.id, u]));
  const requirements = new Map(project.requirements.map((r) => [r.id, r]));
  for (const [list, what] of [
    [project.actors, "$.actors"],
    [project.requirements, "$.requirements"],
    [project.useCases, "$.useCases"],
    [project.diagrams, "$.diagrams"],
    [project.milestones, "$.milestones"],
  ] as Array<[Array<{ id: string }>, string]>) {
    const seen = new Set<string>();
    for (const { id } of list) {
      if (seen.has(id)) add(what, `duplicate id ${id}`);
      seen.add(id);
    }
  }

  // Approval gates engineering.
  const started =
    project.milestones.some((m) => m.status !== "planned") ||
    project.environments.some((e) => e.name !== "local" && e.status === "deployed");
  if (project.approval.status === "approved") {
    if (!project.approval.by || !project.approval.at) add("$.approval", "an approval says who approved and when (by, at)");
    if (!assessment.verdict) add("$.approval", "approval needs a verdict in the assessment (verdict.recommendation)");
    else if (assessment.verdict.recommendation === "no-go") add("$.approval", "the assessment says no-go; engineering cannot be approved against it");
  }
  if (started && project.approval.status !== "approved") {
    add("$.approval", "engineering has started (a milestone is under way or an environment is deployed) without the owner's approval");
  }

  // Requirements trace to capabilities and use cases.
  const referenced = new Set<string>();
  for (const r of project.requirements) {
    const path = `$.requirements.${r.id}`;
    for (const id of r.capabilities) {
      const capability = capabilities.get(id);
      if (!capability) add(path, `unknown capability ${id}`);
      else if (r.priority === "must" && (capability.status === "unsupported" || capability.status === "not-applicable")) {
        add(path, `a must depends on ${id}, which is ${capability.status}; choose another candidate or make it wont`);
      }
    }
    for (const id of r.useCases) {
      if (!useCases.has(id)) add(path, `unknown use case ${id}`);
      referenced.add(id);
    }
    if (r.priority !== "wont" && r.useCases.length === 0) add(path, `a ${r.priority} requirement needs at least one use case`);
  }
  if (!project.requirements.some((r) => r.priority === "must")) add("$.requirements", "no must requirements; MoSCoW needs at least one must");

  // Use cases trace to tests.
  for (const u of project.useCases) {
    const path = `$.useCases.${u.id}`;
    if (!actors.has(u.actor)) add(path, `unknown actor ${u.actor}`);
    if (!referenced.has(u.id)) add(path, "no requirement names this use case");
    u.acceptance.forEach((a, index) => {
      if (a.tests.length === 0) add(`${path}.acceptance[${index}]`, "an acceptance criterion needs a test");
      for (const id of a.tests) if (!tests.has(id)) add(`${path}.acceptance[${index}]`, `unknown test ${id}`);
    });
  }

  // Diagrams: the design set exists before engineering starts.
  for (const d of project.diagrams) {
    const path = `$.diagrams.${d.id}`;
    for (const id of d.covers ?? []) if (!useCases.has(id)) add(path, `unknown use case ${id}`);
    if (baseDir) {
      const file = join(baseDir, d.file);
      if (!existsSync(file)) add(path, `missing file ${d.file}`);
      else if (!readFileSync(file, "utf8").includes("```mermaid")) add(path, `${d.file} has no mermaid block`);
    }
  }
  if (project.approval.status === "approved" || started) {
    for (const kind of ["context", "container", "data-model", "deployment"]) {
      if (!project.diagrams.some((d) => d.kind === kind)) add("$.diagrams", `the design needs a ${kind} diagram`);
    }
    const sequenced = new Set(project.diagrams.filter((d) => d.kind === "sequence").flatMap((d) => d.covers ?? []));
    for (const r of project.requirements.filter((r) => r.priority === "must")) {
      for (const id of r.useCases) if (useCases.has(id) && !sequenced.has(id)) add("$.diagrams", `must use case ${id} has no sequence diagram`);
    }
  }

  // Milestones: every must is planned; done means its tests passed.
  const planned = new Set(project.milestones.flatMap((m) => m.requirements));
  for (const r of project.requirements) {
    if (r.priority === "must" && !planned.has(r.id)) add(`$.requirements.${r.id}`, "a must requirement is in no milestone");
  }
  for (const m of project.milestones) {
    const path = `$.milestones.${m.id}`;
    for (const id of m.requirements) {
      const r = requirements.get(id);
      if (!r) add(path, `unknown requirement ${id}`);
      else if (r.priority === "wont") add(path, `${id} is wont and cannot be scheduled`);
    }
    if (m.status === "done") {
      for (const id of m.requirements) {
        if (requirements.has(id) && !requirementDone(project, assessment, id)) add(path, `done, but ${id} has acceptance tests that have not passed`);
      }
    }
  }

  // Environments: a shared deploy has an owner's go-ahead and e2e tests behind it.
  for (const e of project.environments) {
    const path = `$.environments.${e.name}`;
    if (e.status !== "deployed") continue;
    if (!e.deployedAt || !e.version) add(path, "a deployed environment says what runs there and since when (version, deployedAt)");
    if ((e.name === "staging" || e.name === "production") && !e.approvedBy) add(path, `${e.name} needs the owner's go-ahead (approvedBy)`);
    if (e.name !== "local") {
      const e2e = e.e2eTests ?? [];
      if (e2e.length === 0) add(path, "a deployed environment needs e2e tests that ran against it");
      for (const id of e2e) {
        const t = tests.get(id);
        if (!t) add(path, `unknown test ${id}`);
        else if (t.runtime !== "deployed" || t.result !== "pass") add(path, `${id} must have passed with runtime deployed`);
      }
    }
    if (e.name === "production") {
      for (const r of project.requirements.filter((r) => r.priority === "must")) {
        if (!requirementDone(project, assessment, r.id)) add(path, `production is deployed but must ${r.id} is not done`);
        for (const id of r.useCases) {
          const u = useCases.get(id);
          const deployed = (u?.acceptance ?? []).flatMap((a) => a.tests).some((t) => tests.get(t)?.runtime === "deployed" && tests.get(t)?.result === "pass");
          if (u && !deployed) add(path, `production is deployed but must use case ${id} has no test that passed deployed`);
        }
      }
    }
  }
  return problems;
}

function readJson(file: string): { value?: Json; problems: Problem[] } {
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) as Json, problems: [] };
  } catch (error) {
    return { problems: [{ path: "$", message: `not JSON: ${(error as Error).message}` }] };
  }
}

export function validateFile(file: string): Problem[] {
  const { value, problems: parse } = readJson(file);
  if (!value) return parse;
  const problems = checkSchema(value, SCHEMAS["assessment.schema.json"]);
  if (problems.length > 0) return problems;
  return [...checkRules(value as unknown as Assessment), ...checkArchitecture(value as unknown as Assessment)];
}

/** Validates project.json against the assessment.json beside it. */
export function validateProject(file: string): Problem[] {
  const dir = dirname(file);
  const { value, problems: parse } = readJson(file);
  if (!value) return parse;
  const problems = checkSchema(value, SCHEMAS["project.schema.json"]);
  if (problems.length > 0) return problems;
  const assessment = readJson(join(dir, "assessment.json"));
  if (!assessment.value) return [{ path: "$", message: "project.json needs an assessment.json beside it" }];
  if ((assessment.value as { id?: string }).id !== (value as { id?: string }).id) problems.push({ path: "$.id", message: "id differs from the assessment's" });
  return [...problems, ...checkProject(value as unknown as Project, assessment.value as unknown as Assessment, dir)];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("usage: bun scripts/validate.ts <app>/docs/serverless [...]");
    process.exit(2);
  }
  const dirs = args.map((arg) => (arg.endsWith(".json") ? dirname(resolve(arg)) : resolve(arg)));
  const targets: Array<[string, (file: string) => Problem[]]> = [];
  for (const dir of dirs) {
    if (existsSync(join(dir, "assessment.json"))) targets.push([join(dir, "assessment.json"), validateFile]);
    if (existsSync(join(dir, "project.json"))) targets.push([join(dir, "project.json"), validateProject]);
  }
  let failed = 0;
  const show = (file: string) => file.replace(`${ROOT}/`, "");
  for (const [file, check] of targets) {
    const problems = check(file);
    if (problems.length === 0) console.log(`ok    ${show(file)}`);
    else {
      failed += 1;
      console.log(`FAIL  ${show(file)}`);
      for (const problem of problems) console.log(`      ${problem.path}: ${problem.message}`);
    }
  }
  if (targets.length === 0) console.log("no assessments found");
  process.exit(failed === 0 ? 0 : 1);
}
