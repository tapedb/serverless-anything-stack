// t.autosave-load: EDITORS editors in one dataset autosave their own draft
// about once a second for SECONDS seconds while LIVE live queries watch the
// drafts; reports write latency (send to acknowledgement) and checks that
// every save landed. Runs with CMS_URL (a deployment) or CMS_LOAD=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPLOYED, dataset, person, startDev } from "./harness.mjs";
import { createDocument, editDraft } from "../cms/ops.ts";

startDev();

const EDITORS = Number(process.env.EDITORS ?? 20);
const LIVE = Number(process.env.LIVE ?? 100);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 30);

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

test(`${EDITORS} editors autosaving once a second with ${LIVE} live queries`, { timeout: 600_000 }, async (t) => {
  if (!DEPLOYED && !process.env.CMS_LOAD) return t.skip("set CMS_URL (deployed) or CMS_LOAD=1");
  const ws = dataset();
  const editors = Array.from({ length: EDITORS }, (_, i) => ({ sub: `editor-${i}`, db: person(ws, `editor-${i}`, "editor") }));
  for (const e of editors) e.docId = await createDocument(e.db, "post", { title: `${e.sub} draft` });

  // LIVE subscriptions spread over the editors' clients: the draft list, and each editor's own draft.
  const stops = [];
  let updates = 0;
  for (let i = 0; i < LIVE; i++) {
    const e = editors[i % EDITORS];
    const query = i % 2 === 0 ? e.db.postDraft.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }) : e.db.postDraft.findUnique({ where: { id: editors[(i + 1) % EDITORS].docId } });
    stops.push(query.subscribe(({ data }) => { if (data) updates += 1; }));
  }
  await new Promise((r) => setTimeout(r, 2000));

  const latencies = [];
  const failures = [];
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(editors.map(async (e, i) => {
    await new Promise((r) => setTimeout(r, (i * 1000) / EDITORS)); // spread the editors over the second
    let n = 0;
    while (Date.now() < end) {
      const t0 = Date.now();
      try {
        await editDraft(e.db, "post", e.docId, { summary: `${e.sub} save ${++n}` });
        latencies.push(Date.now() - t0);
      } catch (error) {
        failures.push(String(error?.code ?? error));
      }
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t0))));
    }
    e.saves = n;
  }));
  for (const stop of stops) stop();

  latencies.sort((a, b) => a - b);
  const result = {
    runtime: DEPLOYED ? "deployed" : "tapedb dev",
    editors: EDITORS, live: LIVE, seconds: SECONDS,
    saves: latencies.length, failures: failures.length,
    p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), p99: quantile(latencies, 0.99), max: latencies.at(-1),
    liveUpdates: updates,
  };
  console.log(`autosave load: ${JSON.stringify(result)}`);
  assert.equal(failures.length, 0, `failed saves: ${failures.slice(0, 5).join(", ")}`);
  // Every editor's last save is what the draft holds.
  for (const e of editors) {
    const d = await e.db.postDraft.findUnique({ where: { id: e.docId } });
    assert.equal(d.summary, `${e.sub} save ${e.saves}`);
  }
});
