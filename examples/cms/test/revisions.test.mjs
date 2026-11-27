// t.revisions: every publish and unpublish writes an immutable revision in the
// same transaction; an earlier revision can be restored into the draft and
// published again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataset, doc, person, refused, startDev } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { createDocument, ensureDraft, publish, restoreRevision, revisions, unpublish } from "../cms/ops.ts";

startDev();

const draftOf = (db, id) => db.authorDraft.findUnique({ where: { id } });

async function publishName(db, id, name, baseRev) {
  await ensureDraft(db, contentTypes, "author", id);
  await db.authorDraft.update({ where: { id }, data: { name } });
  await publish(db, contentTypes, "author", await draftOf(db, id), baseRev);
}

test("each publish and unpublish leaves a revision with its values, rev and writer", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const eve = person(ws, "eve", "editor");
  const id = await createDocument(ed, "author", { name: "v1", bio: doc("first") });
  await publish(ed, contentTypes, "author", await draftOf(ed, id), 0);
  await publishName(eve, id, "v2", 1);
  await unpublish(ed, contentTypes, "author", id, 2);

  const revs = await revisions(ed, "author", id);
  assert.deepEqual(revs.map((r) => [r.rev, r.values.name, r.by, r.publishedAt === null]), [
    [1, "v1", "ed", false],
    [2, "v2", "eve", false],
    [3, "v2", "ed", true],
  ]);
  assert.deepEqual(revs[0].values.bio, doc("first"));
  assert.equal((await ed.author.findUnique({ where: { id } })).rev, 3);
});

test("a refused publish leaves no revision behind", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const id = await createDocument(ed, "author", { name: "v1" });
  await publish(ed, contentTypes, "author", await draftOf(ed, id), 0);
  // Stale: the document is at rev 1, this publish claims rev 0.
  await ensureDraft(ed, contentTypes, "author", id);
  await refused(publish(ed, contentTypes, "author", await draftOf(ed, id), 0));
  assert.deepEqual((await revisions(ed, "author", id)).map((r) => r.rev), [1]);
});

test("revisions cannot be edited, nor written in someone else's name", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const admin = person(ws, "ada", "admin");
  const id = await createDocument(ed, "author", { name: "v1" });
  await publish(ed, contentTypes, "author", await draftOf(ed, id), 0);
  const [rev] = await revisions(ed, "author", id);
  await refused(ed.authorRevision.update({ where: { id: rev.id }, data: { values: { name: "rewritten" } } }));
  await refused(admin.authorRevision.update({ where: { id: rev.id }, data: { by: "someone" } }));
  await refused(ed.authorRevision.create({ data: { documentId: id, rev: 9, values: { name: "x" }, by: "eve" } }));
  assert.equal((await revisions(ed, "author", id))[0].values.name, "v1");
});

test("restoring an earlier revision puts its values in the draft; publishing makes a new revision", async () => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  const id = await createDocument(ed, "author", { name: "Original", bio: doc("original bio") });
  await publish(ed, contentTypes, "author", await draftOf(ed, id), 0);
  await publishName(ed, id, "Changed", 1);
  // Someone has a draft open as well: restoring replaces it.
  await ensureDraft(ed, contentTypes, "author", id);
  await ed.authorDraft.update({ where: { id }, data: { name: "Work in progress" } });

  await restoreRevision(ed, "author", id, 1);
  const draft = await draftOf(ed, id);
  assert.equal(draft.name, "Original");
  assert.deepEqual(draft.bio, doc("original bio"));
  // The published document is untouched until the restore is published.
  assert.equal((await ed.author.findUnique({ where: { id } })).name, "Changed");

  await publish(ed, contentTypes, "author", draft, 2);
  const after = await ed.author.findUnique({ where: { id } });
  assert.equal(after.rev, 3);
  assert.equal(after.name, "Original");
  assert.deepEqual((await revisions(ed, "author", id)).map((r) => r.values.name), ["Original", "Changed", "Original"]);
});
