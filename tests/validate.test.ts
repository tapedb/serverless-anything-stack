import { describe, expect, test } from "bun:test";
import { checkRules, checkSchema } from "../scripts/validate";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { minimal } from "./shapes";

const schema = JSON.parse(readFileSync(join(import.meta.dir, "../schemas/assessment.schema.json"), "utf8"));

const problems = (value: ReturnType<typeof minimal>) => {
  const shape = checkSchema(value as never, schema);
  return shape.length > 0 ? shape : checkRules(value as never);
};
const messages = (value: ReturnType<typeof minimal>) => problems(value).map((p) => p.message);

describe("validate", () => {
  test("the minimal assessment passes", () => {
    expect(problems(minimal())).toEqual([]);
  });

  test("verified without candidate evidence is refused", () => {
    const value = minimal();
    value.capabilities[0].candidateEvidence = [];
    expect(messages(value)).toContain("verified needs evidence for the candidate");
  });

  test("verified without a passing acceptance test is refused", () => {
    const value = minimal();
    value.tests[0].result = "not-run";
    delete (value.tests[0] as { ranAt?: string }).ranAt;
    expect(messages(value)).toContain("verified needs an acceptance test that passed");
  });

  test("verified with gaps is refused", () => {
    const value = minimal();
    value.capabilities[0].gaps = ["no ordering"];
    expect(messages(value)).toContain("verified with gaps is partial, not verified");
  });

  test("verified evidence must say when it was checked", () => {
    const value = minimal();
    delete (value.evidence[1] as { checkedAt?: string }).checkedAt;
    expect(messages(value)).toContain("evidence td.tx behind a verified claim needs checkedAt");
  });

  test("a deployed claim needs a deployed test", () => {
    const value = minimal();
    value.capabilities[0].candidate = "TapeDB workspace transactions, deployed";
    expect(messages(value)).toContain("a candidate described as deployed needs a deployed test that passed");
    value.tests[0].runtime = "deployed";
    expect(problems(value)).toEqual([]);
  });

  test("partial must name gaps; unsupported cannot be reused; not-applicable is excluded", () => {
    const partial = minimal();
    partial.capabilities[0].status = "partial";
    expect(messages(partial)).toContain("partial must name its gaps");
    const unsupported = minimal();
    unsupported.capabilities[0].status = "unsupported";
    expect(messages(unsupported)).toContain("an unsupported capability cannot be reused");
    const excluded = minimal();
    excluded.capabilities[0].status = "not-applicable";
    expect(messages(excluded)).toContain("not-applicable is excluded");
  });

  test("references must resolve", () => {
    const value = minimal();
    value.features[0].evidence = ["missing"];
    value.capabilities[0].acceptanceTests = ["t.tx", "t.missing"];
    value.features[0].capabilities = ["nope"];
    const found = messages(value);
    expect(found).toContain("unknown evidence missing");
    expect(found).toContain("unknown test t.missing");
    expect(found).toContain("unknown capability nope");
  });

  test("a decision's choice must be one of its options, and costs cite pricing", () => {
    const value = minimal();
    value.decisions[0].choice = "Postgres";
    value.costAssumptions[0].source = "up.models";
    const found = messages(value);
    expect(found).toContain('choice "Postgres" is not one of its options');
    expect(found).toContain("up.models is not pricing evidence");
  });

  test("a test that ran needs a date, and the schema refuses unknown fields and branch-like values", () => {
    const ran = minimal();
    delete (ran.tests[0] as { ranAt?: string }).ranAt;
    expect(messages(ran)).toContain("a test that ran says when (ranAt)");
    const extra = minimal() as ReturnType<typeof minimal> & { parity?: boolean };
    extra.parity = true;
    expect(messages(extra)).toContain("unknown property parity");
    const status = minimal();
    (status.capabilities[0] as { status: string }).status = "done";
    expect(messages(status).some((m) => m.startsWith("must be one of"))).toBe(true);
  });
});
