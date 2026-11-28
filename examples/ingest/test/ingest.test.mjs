// Ingest fixture (recipes: ingestion, async) against `tapedb dev`: workerd, local Queues
// with a dead-letter queue, a WorkspaceRoom per organization.
//
//   npm test
//
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const PORT = 8795;
const URL = `http://localhost:${PORT}`;
const ROOT = new globalThis.URL("..", import.meta.url).pathname;
const TOKEN = /TAPEDB_API_TOKEN=(.+)/.exec(readFileSync(`${ROOT}.dev.vars`, "utf8"))[1].trim();
const ORG_A = "7f3c9d2e-4b1a-4c8e-9f6d-2a5b8c1e3d4f";
const ORG_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
let dev;

before(async () => {
  dev = spawn("npx", ["--no-install", "tapedb-cli", "dev", "--port", String(PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 90_000;
  for (;;) {
    try { if ((await query(ORG_A, { issue: {} })).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`tapedb dev did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
});
after(() => { try { process.kill(-dev.pid, "SIGTERM"); } catch {} });

async function query(workspace, q) {
  const r = await fetch(`${URL}/v1/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ workspace, as: { sub: "ingest", role: 6 }, query: q }),
  });
  return r.json();
}

const envelope = (...events) =>
  [JSON.stringify({ event_id: crypto.randomUUID() }), ...events.flatMap((e) => [JSON.stringify({ type: "event" }), typeof e === "string" ? e : JSON.stringify(e)])].join("\n") + "\n";

const send = (key, body) =>
  fetch(`${URL}/api/1/envelope/`, { method: "POST", headers: { "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}` }, body });

async function until(check, label, ms = 20_000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    last = await check();
    if (last.done) return last.value;
    if (Date.now() > deadline) throw new Error(`${label}: ${JSON.stringify(last.value)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const exception = (type, value) => ({ exception: { values: [{ type, value }] }, level: "error" });
const tag = () => Math.random().toString(36).slice(2, 8);

test("an unknown project key is refused before anything is queued", async () => {
  const r = await send("no-such-key", envelope(exception("Error", "x")));
  assert.equal(r.status, 401);
});

test("events group into issues by fingerprint; counts are the sum of tallies", async () => {
  const t = tag();
  // Same type and value apart from numbers: one issue. A different type: another.
  const r = await send("key-org-a", envelope(
    exception(`TypeError${t}`, "x is undefined at line 10"),
    exception(`TypeError${t}`, "x is undefined at line 99"),
    exception(`TypeError${t}`, "x is undefined at line 7"),
    exception(`RangeError${t}`, "index 4 out of range"),
  ));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 4);

  const issues = await until(async () => {
    const d = (await query(ORG_A, { issue: { tallies: {} } })).data.issue.filter((i) => i.title.includes(t));
    return { done: d.length === 2 && d.reduce((n, i) => n + i.tallies.length, 0) === 4, value: d };
  }, "issues never settled");
  const byType = Object.fromEntries(issues.map((i) => [i.title.split(":")[0], i.tallies.reduce((n, x) => n + x.count, 0)]));
  assert.deepEqual(byType, { [`TypeError${t}`]: 3, [`RangeError${t}`]: 1 });
});

test("organizations are separate workspaces", async () => {
  const t = tag();
  await send("key-org-b", envelope(exception(`OnlyB${t}`, "b")));
  await until(async () => {
    const d = (await query(ORG_B, { issue: {} })).data.issue.filter((i) => i.title.includes(t));
    return { done: d.length === 1, value: d };
  }, "org B issue never appeared");
  const inA = (await query(ORG_A, { issue: {} })).data.issue.filter((i) => i.title.includes(t));
  assert.equal(inA.length, 0);
});

test("a poison event is retried, dead-lettered and recorded; its siblings are not held back", async () => {
  const t = tag();
  const r = await send("key-org-a", envelope(`{"not json ${t}`, exception(`Fine${t}`, "ok")));
  assert.equal(r.status, 200);
  // The good sibling lands without waiting for the poison one's retries.
  await until(async () => {
    const d = (await query(ORG_A, { issue: {} })).data.issue.filter((i) => i.title.includes(`Fine${t}`));
    return { done: d.length === 1, value: d };
  }, "sibling never grouped");
  const dead = await until(async () => {
    const d = (await query(ORG_A, { deadLetter: {} })).data.deadLetter.filter((x) => x.body.includes(t));
    return { done: d.length === 1, value: d };
  }, "poison never dead-lettered", 30_000);
  assert.equal(dead[0].reason, "grouping failed after retries");
  assert.ok(dead[0].attempts >= 1);
});

test("a message redelivered after its write does not count twice", async () => {
  const t = tag();
  const event = { ...exception(`Redelivered${t}`, "boom"), extra: { fixtureFailAfterWrite: true } };
  assert.equal((await send("key-org-a", envelope(event))).status, 200);
  // Wait past the redelivery: the first attempt wrote, failed, and was retried.
  const issue = await until(async () => {
    const d = (await query(ORG_A, { issue: { tallies: {} } })).data.issue.filter((i) => i.title.includes(t));
    return { done: d.length === 1, value: d };
  }, "issue never appeared");
  await new Promise((r) => setTimeout(r, 4000));
  const again = (await query(ORG_A, { issue: { tallies: {} } })).data.issue.filter((i) => i.title.includes(t));
  assert.equal(again[0].tallies.length, 1);
  assert.equal(again[0].tallies.reduce((n, x) => n + x.count, 0), 1);
  assert.equal(issue[0].id, again[0].id);
});
