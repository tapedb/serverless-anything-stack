/**
 * The smallest valid shapes, used by the tests and as a reference for the
 * files an application keeps in docs/serverless/.
 */
export /** The smallest assessment the validator accepts, with one verified capability. */
function minimal() {
  return {
    schemaVersion: 1,
    id: "example",
    approach: "compatible-rewrite",
    upstream: { name: "Example", url: "https://example.invalid/repo", revision: "abc1234", license: "MIT", inspectedAt: "2026-11-26" },
    evidence: [
      { id: "up.models", kind: "source", ref: "app/models/thing.rb", revision: "abc1234", note: "The model." },
      { id: "td.tx", kind: "test", ref: "fixtures/transactional", checkedAt: "2026-11-26", note: "Fixture." },
      { id: "cf.pricing", kind: "pricing", ref: "https://developers.cloudflare.com/durable-objects/platform/pricing/", checkedAt: "2026-11-26", note: "Pricing page." },
    ],
    features: [{ id: "things", name: "Things", workload: "transactional", evidence: ["up.models"], capabilities: ["state"] }],
    dependencies: [{ name: "PostgreSQL", role: "primary store", required: true, evidence: ["up.models"] }],
    workloadAssumptions: ["100 writes per second per tenant at peak"],
    architecture: { summary: "One workspace per tenant.", components: [{ name: "Tenant", primitive: "TapeDB workspace", responsibility: "State" }] },
    capabilities: [
      {
        id: "state",
        description: "Typed state with transactions",
        workload: "transactional",
        upstreamEvidence: ["up.models"],
        candidate: "TapeDB workspace transactions",
        candidateEvidence: ["td.tx"],
        status: "verified",
        gaps: [],
        owner: "tapedb",
        acceptanceTests: ["t.tx"],
        decision: "reuse",
      },
    ],
    risks: [{ id: "r1", description: "Hot tenant", mitigation: "Measure" }],
    costAssumptions: [{ driver: "Durable Object requests", assumption: "1M per month", source: "cf.pricing" }],
    decisions: [
      { id: "d1", title: "Store", status: "accepted", context: "Need state", options: [{ name: "TapeDB", tradeoffs: "a" }, { name: "D1", tradeoffs: "b" }], choice: "TapeDB", consequences: "c" },
    ],
    tests: [{ id: "t.tx", description: "transactions", runtime: "workerd-local", result: "pass", ranAt: "2026-11-26", evidence: ["td.tx"] }],
  };
}

