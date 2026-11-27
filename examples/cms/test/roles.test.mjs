// t.roles: readers (user) see published documents only; contributors (member)
// write drafts but cannot publish; editors publish but cannot delete; admins
// delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataset, person, refused, startDev } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { createDocument, createRelease, publish } from "../cms/ops.ts";

startDev();

async function cast() {
  const ws = dataset();
  return {
    reader: person(ws, "rita", "user"),
    contributor: person(ws, "carl", "member"),
    editor: person(ws, "ed", "editor"),
    admin: person(ws, "ada", "admin"),
  };
}

test("a reader sees published documents only and cannot write", async () => {
  const { reader, editor } = await cast();
  const authorId = await createDocument(editor, "author", { name: "Draft only" });
  assert.deepEqual(await reader.author.findMany({}), []);
  assert.equal((await refused(reader.authorDraft.findMany({}))).code, "permission_denied");
  await refused(createDocument(reader, "author", { name: "Rita" }));
  await refused(reader.authorDraft.update({ where: { id: authorId }, data: { name: "x" } }));
  await refused(reader.authorRevision.findMany({}));
  await refused(reader.cmsRelease.create({ data: { name: "r" } }));
});

test("a contributor writes drafts but cannot publish", async () => {
  const { contributor, editor } = await cast();
  const authorId = await createDocument(contributor, "author", { name: "Carl's draft" });
  await contributor.authorDraft.update({ where: { id: authorId }, data: { name: "Carl's draft, edited" } });
  const draft = await contributor.authorDraft.findUnique({ where: { id: authorId } });
  assert.equal((await refused(publish(contributor, contentTypes, "author", draft, 0))).code, "permission_denied");
  // Not straight at the model either, nor by creating a document already published.
  await refused(contributor.author.update({ where: { id: authorId }, data: { name: "x", rev: 1, publishedAt: Date.now() } }));
  await refused(contributor.author.create({ data: { name: "y", rev: 0, publishedAt: Date.now() } }));
  // The editor publishes the contributor's draft.
  await publish(editor, contentTypes, "author", draft, 0);
  assert.equal((await contributor.author.findUnique({ where: { id: authorId } })).rev, 1);
});

test("an editor publishes but cannot delete a document; an admin can", async () => {
  const { editor, admin } = await cast();
  const postAuthor = await createDocument(editor, "author", { name: "Ed" });
  await publish(editor, contentTypes, "author", await editor.authorDraft.findUnique({ where: { id: postAuthor } }), 0);
  assert.equal((await refused(editor.author.delete({ where: { id: postAuthor } }))).code, "permission_denied");
  await admin.author.delete({ where: { id: postAuthor } });
  assert.equal(await admin.author.findUnique({ where: { id: postAuthor } }), null);
  // The delete cascaded to the document's revisions.
  assert.deepEqual(await admin.authorRevision.findMany({ where: { documentId: postAuthor } }), []);
});

test("a contributor cannot write a revision or publish a release", async () => {
  const { contributor, editor } = await cast();
  const authorId = await createDocument(editor, "author", { name: "A" });
  await refused(contributor.authorRevision.create({ data: { documentId: authorId, rev: 1, values: { name: "fake" }, by: "carl" } }));
  const releaseId = await createRelease(contributor, "Spring");
  await refused(contributor.cmsRelease.update({ where: { id: releaseId }, data: { state: "published", publishedAt: Date.now() } }));
  assert.equal((await editor.cmsRelease.findUnique({ where: { id: releaseId } })).state, "open");
});
