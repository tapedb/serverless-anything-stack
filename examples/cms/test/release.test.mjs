// t.fixture-release: versions of several documents grouped in a release and
// published in one transaction; one stale document refuses the whole release;
// a release publishes once; 1,000 versions publish whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPLOYED, dataset, doc, person, refused, startDev } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { addToRelease, createDocument, createRelease, ensureDraft, publish, publishRelease, revisions } from "../cms/ops.ts";

startDev();

async function publishedAuthors(db, names) {
  const ids = [];
  for (const name of names) {
    const id = await createDocument(db, "author", { name });
    await publish(db, contentTypes, "author", await db.authorDraft.findUnique({ where: { id } }), 0);
    ids.push(id);
  }
  return ids;
}

test("a release publishes all its documents at once, new and existing, across types", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const carl = person(ws, "carl", "member");
  const reader = person(ws, "rita", "user");
  const [ada, bo] = await publishedAuthors(ed, ["Ada", "Bo"]);
  // A new post that does not exist for readers yet, and changes to two authors.
  const postId = await createDocument(carl, "post", { title: "Spring launch" });
  const releaseId = await createRelease(carl, "Spring");
  await addToRelease(carl, "author", releaseId, ada, { name: "Ada (spring)" });
  await addToRelease(carl, "author", releaseId, bo, { name: "Bo (spring)" });
  await addToRelease(carl, "post", releaseId, postId, { title: "Spring launch", slug: "spring", body: doc("We launch"), authorId: ada });

  // Nothing is visible to readers before the release.
  assert.deepEqual((await reader.author.findMany({ orderBy: { name: "asc" } })).map((a) => a.name), ["Ada", "Bo"]);
  assert.deepEqual(await reader.post.findMany({}), []);

  const seen = [];
  const stop = reader.author.findMany({ orderBy: { name: "asc" } }).subscribe(({ data, isLoading }) => {
    if (!isLoading && data) seen.push(data.map((a) => a.name).join("|"));
  });
  await new Promise((r) => setTimeout(r, 300));
  await publishRelease(ed, contentTypes, releaseId);
  await new Promise((r) => setTimeout(r, 500));
  stop();

  assert.deepEqual((await reader.author.findMany({ orderBy: { name: "asc" } })).map((a) => a.name), ["Ada (spring)", "Bo (spring)"]);
  assert.equal((await reader.post.findUnique({ where: { id: postId } })).slug, "spring");
  // A live reader never saw one author changed without the other.
  for (const s of seen) assert.ok(s === "Ada|Bo" || s === "Ada (spring)|Bo (spring)", `half a release: ${s}`);
  assert.equal((await ed.cmsRelease.findUnique({ where: { id: releaseId } })).state, "published");
  assert.deepEqual(await ed.authorVersion.findMany({ where: { releaseId } }), []);
  assert.deepEqual((await revisions(ed, "author", ada)).map((r) => r.values.name), ["Ada", "Ada (spring)"]);
});

test("one document changed after the release was read refuses the whole release", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const [ada, bo] = await publishedAuthors(ed, ["Ada", "Bo"]);
  const releaseId = await createRelease(ed, "Autumn");
  await addToRelease(ed, "author", releaseId, ada, { name: "Ada (autumn)" });
  await addToRelease(ed, "author", releaseId, bo, { name: "Bo (autumn)" });

  // Build the release's writes from the current revisions, then let Bo move on before they commit.
  const db = person(ws, "ed2", "editor");
  const realFindMany = db.author.findMany.bind(db.author);
  db.author.findMany = async (args) => {
    const docs = await realFindMany(args);
    await ensureDraft(ed, contentTypes, "author", bo);
    await ed.authorDraft.update({ where: { id: bo }, data: { name: "Bo (hotfix)" } });
    await publish(ed, contentTypes, "author", await ed.authorDraft.findUnique({ where: { id: bo } }), 1);
    return docs;
  };
  await refused(publishRelease(db, contentTypes, releaseId));

  // Nothing of the release landed: Ada unchanged, Bo is the hotfix, versions and release still open.
  assert.equal((await ed.author.findUnique({ where: { id: ada } })).name, "Ada");
  assert.equal((await ed.author.findUnique({ where: { id: bo } })).name, "Bo (hotfix)");
  assert.equal((await ed.authorVersion.findMany({ where: { releaseId } })).length, 2);
  assert.equal((await ed.cmsRelease.findUnique({ where: { id: releaseId } })).state, "open");
  assert.deepEqual((await revisions(ed, "author", ada)).map((r) => r.rev), [1]);

  // Published again against the current revisions, it lands whole.
  await publishRelease(ed, contentTypes, releaseId);
  assert.equal((await ed.author.findUnique({ where: { id: ada } })).name, "Ada (autumn)");
  assert.equal((await ed.author.findUnique({ where: { id: bo } })).name, "Bo (autumn)");
});

test("a release with an invalid version is refused whole", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const [ada] = await publishedAuthors(ed, ["Ada"]);
  const postId = await createDocument(ed, "post", { title: "Incomplete" });
  const releaseId = await createRelease(ed, "Broken");
  await addToRelease(ed, "author", releaseId, ada, { name: "Ada (broken release)" });
  await addToRelease(ed, "post", releaseId, postId, { title: "Incomplete" }); // no slug, body or author
  await refused(publishRelease(ed, contentTypes, releaseId));
  assert.equal((await ed.author.findUnique({ where: { id: ada } })).name, "Ada");
  assert.equal((await ed.cmsRelease.findUnique({ where: { id: releaseId } })).state, "open");
});

test("a release publishes once: two editors at the same time, exactly one lands", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const eve = person(ws, "eve", "editor");
  const [ada] = await publishedAuthors(ed, ["Ada"]);
  const releaseId = await createRelease(ed, "Once");
  await addToRelease(ed, "author", releaseId, ada, { name: "Ada (once)" });
  const results = await Promise.allSettled([publishRelease(ed, contentTypes, releaseId), publishRelease(eve, contentTypes, releaseId)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.deepEqual((await revisions(ed, "author", ada)).map((r) => r.rev), [1, 2]);
  // A published release cannot be changed or reopened.
  await refused(ed.cmsRelease.update({ where: { id: releaseId }, data: { state: "open" } }));
  await refused(ed.cmsRelease.update({ where: { id: releaseId }, data: { name: "renamed" } }));
});

test("a release of 1,000 new documents publishes whole", { timeout: 300_000 }, async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const [ada] = await publishedAuthors(ed, ["Ada"]);
  const N = 1000;
  const releaseId = await createRelease(ed, "Big");
  // Create the documents and their versions in bulk transactions of 250.
  const ids = [];
  for (let start = 0; start < N; start += 250) {
    const writes = [];
    for (let i = start; i < Math.min(N, start + 250); i++) {
      const id = (await import("@tapedb/tapedb")).id();
      ids.push(id);
      writes.push(ed.post.create({ data: { id, rev: 0 } }));
      writes.push(ed.postVersion.create({ data: { releaseId, documentId: id, title: `Post ${i}`, slug: `post-${i}`, body: doc(`body ${i}`), authorId: ada } }));
    }
    await ed.$transaction(writes);
  }
  const t0 = Date.now();
  await publishRelease(ed, contentTypes, releaseId);
  const ms = Date.now() - t0;
  const reader = person(ws, "rita", "user");
  assert.equal(await reader.post.count({}), N);
  assert.equal(await ed.postVersion.count({ where: { releaseId } }), 0);
  assert.equal(await ed.postRevision.count({}), N);
  console.log(`release of ${N} versions (${3 * N + 1} writes) published in ${ms} ms (${DEPLOYED ? "deployed" : "tapedb dev"})`);
});
