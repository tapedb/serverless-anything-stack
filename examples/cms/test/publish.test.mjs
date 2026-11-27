// t.fixture-publish (cases/sanity): a draft becomes the published document in
// one transaction; readers never see a draft or half a publish; a publish
// based on an older revision is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataset, doc, person, refused, startDev } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { createDocument, ensureDraft, publish, takeLock, unpublish } from "../cms/ops.ts";

startDev();

async function setup() {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const reader = person(ws, "rita", "member");
  const authorId = await createDocument(ed, "author", { name: "Ada" });
  await publish(ed, contentTypes, "author", await ed.authorDraft.findUnique({ where: { id: authorId } }), 0);
  const postId = await createDocument(ed, "post", { title: "Launch", slug: "launch", body: doc("v1"), authorId });
  return { ws, ed, reader, authorId, postId };
}

const draftOf = (db, id) => db.postDraft.findUnique({ where: { id } });

test("readers see nothing until publish, then the whole document; the draft is gone", async () => {
  const { ed, reader, postId } = await setup();
  assert.deepEqual(await reader.post.findMany({}), [], "an unpublished document is invisible to readers");
  assert.equal((await refused(reader.postDraft.findMany({}))).code, "permission_denied", "drafts are for editors");

  await publish(ed, contentTypes, "post", await draftOf(ed, postId), 0);
  const [post] = await reader.post.findMany({});
  assert.equal(post.id, postId);
  assert.equal(post.title, "Launch");
  assert.deepEqual(post.body, doc("v1"));
  assert.equal(post.rev, 1);
  assert.equal(await draftOf(ed, postId), null);
});

test("a live reader sees the publish as one change", async () => {
  const { ed, reader, postId } = await setup();
  const states = [];
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const stop = reader.post.findMany({}).subscribe(({ data, isLoading }) => {
    if (isLoading || !data) return;
    states.push(data.map((p) => ({ title: p.title, body: p.body, rev: p.rev })));
    if (data.length === 1) resolveDone();
  });
  await new Promise((r) => setTimeout(r, 300));
  await publish(ed, contentTypes, "post", await draftOf(ed, postId), 0);
  await Promise.race([done, new Promise((_, no) => setTimeout(() => no(new Error(`no publish seen: ${JSON.stringify(states)}`)), 10_000))]);
  stop();
  // Every state is either before (no post) or after (the full post): nothing in between.
  for (const s of states) assert.ok(s.length === 0 || (s.length === 1 && s[0].title === "Launch" && s[0].rev === 1 && s[0].body?.content), JSON.stringify(s));
});

test("two editors publishing from the same revision: exactly one lands", async () => {
  const { ws, ed, postId } = await setup();
  await publish(ed, contentTypes, "post", await draftOf(ed, postId), 0);

  // Both open the published document (rev 1) and edit the one draft.
  const a = person(ws, "alex", "editor");
  const b = person(ws, "bea", "editor");
  await ensureDraft(a, contentTypes, "post", postId);
  await a.postDraft.update({ where: { id: postId }, data: { title: "Launch, edited by Alex" } });
  const draftA = await draftOf(a, postId);
  const draftB = { ...draftA, title: "Launch, edited by Bea" };

  const results = await Promise.allSettled([
    publish(a, contentTypes, "post", draftA, 1),
    publish(b, contentTypes, "post", draftB, 1),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status)));
  const post = await ed.post.findUnique({ where: { id: postId } });
  assert.equal(post.rev, 2);
  assert.ok(["Launch, edited by Alex", "Launch, edited by Bea"].includes(post.title));
});

test("a publish based on an older revision is refused, and leaves the draft and document as they were", async () => {
  const { ws, ed, postId } = await setup();
  await publish(ed, contentTypes, "post", await draftOf(ed, postId), 0);

  // Bea read the document at rev 1 and keeps that revision.
  const bea = person(ws, "bea", "editor");
  const seenByBea = (await bea.post.findUnique({ where: { id: postId } })).rev;

  // Meanwhile Alex publishes a new revision (rev 2).
  const alex = person(ws, "alex", "editor");
  await ensureDraft(alex, contentTypes, "post", postId);
  await alex.postDraft.update({ where: { id: postId }, data: { summary: "Alex's summary" } });
  await publish(alex, contentTypes, "post", await draftOf(alex, postId), 1);

  // Bea opens a draft and publishes against the rev she saw: refused by the revision check.
  await ensureDraft(bea, contentTypes, "post", postId);
  await bea.postDraft.update({ where: { id: postId }, data: { title: "Bea's title" } });
  const stale = await refused(publish(bea, contentTypes, "post", await draftOf(bea, postId), seenByBea));
  assert.equal(stale.code, "permission_denied");

  // Nothing half done: the document is Alex's rev 2, Bea's draft is intact.
  const post = await ed.post.findUnique({ where: { id: postId } });
  assert.equal(post.rev, 2);
  assert.equal(post.summary, "Alex's summary");
  assert.equal((await draftOf(ed, postId)).title, "Bea's title");

  // Against the current revision it lands.
  await publish(bea, contentTypes, "post", await draftOf(bea, postId), 2);
  const after = await ed.post.findUnique({ where: { id: postId } });
  assert.equal(after.rev, 3);
  assert.equal(after.title, "Bea's title");
  assert.equal(after.summary, "Alex's summary");
});

test("an invalid publish rolls back whole: the draft stays and the document does not move", async () => {
  const { ed, reader, postId } = await setup();
  await takeLock(ed, "post", postId, "body", "ed");
  await ed.postDraft.update({ where: { id: postId }, data: { body: null } });
  await refused(publish(ed, contentTypes, "post", await draftOf(ed, postId), 0));
  assert.ok(await draftOf(ed, postId), "the draft was not deleted");
  const post = await ed.post.findUnique({ where: { id: postId } });
  assert.equal(post.rev, 0);
  assert.equal(post.publishedAt, null);
  assert.deepEqual(await reader.post.findMany({}), []);
});

test("unpublish takes the document off the read path and keeps it for editors", async () => {
  const { ed, reader, postId } = await setup();
  await publish(ed, contentTypes, "post", await draftOf(ed, postId), 0);
  assert.equal((await reader.post.findMany({})).length, 1);
  await unpublish(ed, "post", postId, 1);
  assert.deepEqual(await reader.post.findMany({}), []);
  const post = await ed.post.findUnique({ where: { id: postId } });
  assert.equal(post.rev, 2);
  assert.equal(post.title, "Launch");
});
