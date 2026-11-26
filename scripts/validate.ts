/**
 * Validates assessments (cases/<name>/assessment.json) against the schemas in
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
 * No dependencies: the schema checker below implements the JSON Schema subset
 * these schemas use (type, enum, const, required, properties,
 * additionalProperties: false, items, minItems, minLength, pattern, $ref).
 *
 *   bun scripts/validate.ts [file.json ...]   (default: every cases/<name>/assessment.json)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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

export function validateFile(file: string): Problem[] {
  let parsed: Json;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Json;
  } catch (error) {
    return [{ path: "$", message: `not JSON: ${(error as Error).message}` }];
  }
  const problems = checkSchema(parsed, SCHEMAS["assessment.schema.json"]);
  if (problems.length > 0) return problems;
  return checkRules(parsed as unknown as Assessment);
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const targets = files.length > 0
    ? files
    : readdirSync(join(ROOT, "cases"))
        .map((name) => join(ROOT, "cases", name, "assessment.json"))
        .filter((file) => existsSync(file));
  let failed = 0;
  for (const file of targets) {
    const problems = validateFile(file);
    if (problems.length === 0) console.log(`ok    ${file.replace(`${ROOT}/`, "")}`);
    else {
      failed += 1;
      console.log(`FAIL  ${file.replace(`${ROOT}/`, "")}`);
      for (const problem of problems) console.log(`      ${problem.path}: ${problem.message}`);
    }
  }
  if (targets.length === 0) console.log("no assessments found");
  process.exit(failed === 0 ? 0 : 1);
}
