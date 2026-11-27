// t.delivery-snapshot: a publish reaches the anonymous delivery path through
// signed change webhooks; repeated or late deliveries never replace a newer
// revision; an unsigned delivery is refused. Runs under tapedb dev and, with
// CMS_URL set, against a deployment (scripts/deployed.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataset, doc, HOOK_SECRET, person, startDev, URL } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { createDocument, ensureDraft, publish, unpublish } from "../cms/ops.ts";
import { signPayload } from "../cms/signature.ts";

startDev();

/** Polls `path` until `ok(response, body)`; returns the time it took. */
async function until(path, ok, limitMs = 120_000) {
  const t0 = Date.now();
  let last;
  for (;;) {
    const r = await fetch(`${URL}${path}`);
    const body = r.status === 200 ? await r.json() : await r.text();
    last = `${r.status} ${JSON.stringify(body).slice(0, 200)}`;
    if (ok(r, body)) return { ms: Date.now() - t0, response: r, body };
    if (Date.now() - t0 > limitMs) throw new Error(`${path} not ready after ${limitMs} ms: ${last}`);
    await new Promise((res) => setTimeout(res, 500));
  }
}

async function publishedPost(ws) {
  const ed = person(ws, "ed", "editor");
  const authorId = await createDocument(ed, "author", { name: "Ada" });
  await publish(ed, contentTypes, "author", await ed.authorDraft.findUnique({ where: { id: authorId } }), 0);
  const postId = await createDocument(ed, "post", { title: "Hello world", slug: "hello-world", body: doc("v1"), authorId });
  const t0 = Date.now();
  await publish(ed, contentTypes, "post", await ed.postDraft.findUnique({ where: { id: postId } }), 0);
  return { ed, postId, authorId, publishedAt: t0 };
}

test("a published document reaches the delivery path by id and by slug; changes and unpublish follow", { timeout: 600_000 }, async () => {
  const ws = dataset();
  const { ed, postId, publishedAt } = await publishedPost(ws);
  const first = await until(`/content/${ws}/post/${postId}`, (r, b) => r.status === 200 && b.rev === 1);
  const publishToLive = Date.now() - publishedAt;
  assert.equal(first.body.title, "Hello world");
  assert.deepEqual(first.body.body, doc("v1"));

  const bySlug = await until(`/content/${ws}/post?slug=hello-world`, (r, b) => r.status === 200 && b.id === postId);
  assert.equal(bySlug.response.headers.get("cache-control"), "public, max-age=10");
  // The second read of the same URL is served from the cache.
  const again = await fetch(`${URL}/content/${ws}/post?slug=hello-world`);
  assert.equal(again.headers.get("x-cms-cache"), "hit");

  // A new revision with a new slug: the old slug stops resolving.
  await ensureDraft(ed, contentTypes, "post", postId);
  await ed.postDraft.update({ where: { id: postId }, data: { title: "Hello again", slug: "hello-again" } });
  const t1 = Date.now();
  await publish(ed, contentTypes, "post", await ed.postDraft.findUnique({ where: { id: postId } }), 1);
  const second = await until(`/content/${ws}/post?slug=hello-again`, (r, b) => r.status === 200 && b.rev === 2);
  const republishToLive = Date.now() - t1;
  assert.equal(second.body.title, "Hello again");
  await until(`/content/${ws}/post?slug=hello-world`, (r) => r.status === 404, 20_000);

  // Unpublish: gone from delivery (the cache keeps it at most max-age).
  const t2 = Date.now();
  await unpublish(ed, contentTypes, "post", postId, 2);
  await until(`/content/${ws}/post/${postId}`, (r) => r.status === 404);
  const unpublishToGone = Date.now() - t2;
  console.log(`delivery latency: publish ${publishToLive} ms, republish ${republishToLive} ms, unpublish ${unpublishToGone} ms (${process.env.CMS_URL ? "deployed" : "tapedb dev"})`);
});

test("an unsigned or wrongly signed delivery is refused", async () => {
  const body = JSON.stringify({ workspaceId: dataset(), model: "post", op: "update", row: { id: "x", rev: 99, publishedAt: 1 } });
  const unsigned = await fetch(`${URL}/_cms/hook`, { method: "POST", body, headers: { "content-type": "application/json" } });
  assert.equal(unsigned.status, 401);
  const wrong = await fetch(`${URL}/_cms/hook`, { method: "POST", body, headers: { "x-tapedb-signature": await signPayload("not-the-secret", body) } });
  assert.equal(wrong.status, 401);
  const old = await fetch(`${URL}/_cms/hook`, { method: "POST", body, headers: { "x-tapedb-signature": await signPayload(HOOK_SECRET, body, Date.now() - 3_600_000) } });
  assert.equal(old.status, 401, "a signature older than 5 minutes is refused");
});

test("a late delivery of an older revision does not replace the newer one", { timeout: 600_000 }, async () => {
  const ws = dataset();
  const { postId } = await publishedPost(ws);
  const live = await until(`/content/${ws}/post/${postId}`, (r, b) => r.status === 200 && b.rev === 1);
  // A properly signed delivery claiming rev 1 with other values, and one for rev 0.
  for (const rev of [1, 0]) {
    const body = JSON.stringify({ workspaceId: ws, model: "post", op: "update", row: { ...live.body, rev, title: "stale" } });
    const r = await fetch(`${URL}/_cms/hook`, { method: "POST", body, headers: { "x-tapedb-signature": await signPayload(HOOK_SECRET, body) } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).stale, true);
  }
  await new Promise((r) => setTimeout(r, 11_000)); // past max-age, so the read comes from storage
  const now = await (await fetch(`${URL}/content/${ws}/post/${postId}`)).json();
  assert.equal(now.title, "Hello world");
});
