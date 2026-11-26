import { expect, test } from "bun:test";
import { checkArchitecture, validateFile } from "../scripts/validate";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const base = () => ({
  evidence: [{ id: "ev", kind: "source", ref: "x", note: "x" }],
  architecture: {
    summary: "x",
    components: [{ name: "Workspace", primitive: "TapeDB live queries and presence", responsibility: "live views" }] as Array<Record<string, unknown>>,
    exceptions: [] as Array<Record<string, unknown>>,
  },
  capabilities: [] as Array<Record<string, unknown>>,
});
const rules = (a: ReturnType<typeof base>) => checkArchitecture(a as never).map((p) => p.message.split(":")[0]);

test("a socket service next to TapeDB live queries is refused, unless waived with evidence", () => {
  const a = base();
  a.architecture.components.push({ name: "Chat socket", primitive: "Durable Object WebSocket per conversation", responsibility: "fan-out" });
  expect(rules(a)).toEqual(["second-socket"]);
  a.architecture.exceptions.push({ rule: "second-socket", reason: "binary audio frames", evidence: ["ev"] });
  expect(rules(a)).toEqual([]);
});

test("an exception must cite evidence that exists", () => {
  const a = base();
  a.architecture.exceptions.push({ rule: "second-socket", reason: "because", evidence: ["nowhere"] });
  expect(checkArchitecture(a as never).map((p) => p.message)).toEqual(["unknown evidence nowhere"]);
});

test("a second outbox next to TapeDB webhooks is refused; the client outbox is not one", () => {
  const a = base();
  a.architecture.components.push({ name: "Hooks", primitive: "TapeDB webhooks into Queues", responsibility: "delivery" });
  a.architecture.components.push({ name: "Offline", primitive: "TapeDB client outbox", responsibility: "offline writes" });
  expect(rules(a)).toEqual([]);
  a.architecture.components.push({ name: "Events table", primitive: "D1 outbox table polled by cron", responsibility: "delivery" });
  expect(rules(a)).toEqual(["second-outbox"]);
});

test("KV must be optional or justified", () => {
  const a = base();
  a.architecture.components.push({ name: "Cache", primitive: "Workers KV", responsibility: "DSN lookup" });
  expect(rules(a)).toEqual(["mandatory-kv"]);
  a.architecture.components[1].optional = true;
  expect(rules(a)).toEqual([]);
});

test("an ingestion workload reused in TapeDB is refused", () => {
  const a = base();
  a.capabilities.push({ id: "events", workload: "ingestion", decision: "reuse", candidate: "Raw events in a TapeDB workspace" });
  expect(rules(a)).toEqual(["telemetry-in-tapedb"]);
  a.capabilities[0].candidate = "Queues into Basin";
  a.capabilities[0].decision = "external";
  expect(rules(a)).toEqual([]);
});

test("every case in the repository passes the architecture rules", () => {
  const root = join(import.meta.dir, "..", "cases");
  for (const name of readdirSync(root)) expect(validateFile(join(root, name, "assessment.json"))).toEqual([]);
});
