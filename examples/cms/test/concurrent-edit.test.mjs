// t.concurrent-edit (cases/sanity): what concurrent editing does on TapeDB's
// whole-attribute writes, and what the v1 field locks change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataset, doc, person, refused, startDev } from "./harness.mjs";
import { createDocument, editDraft, releaseLock, takeLock } from "../cms/ops.ts";
import { LOCK_MS } from "../cms/content.ts";

startDev();

const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const texts = (body) => body.content.map((p) => p.content[0].text);

test("two editors writing different fields of one draft at once: both land", async () => {
  const ws = dataset();
  const a = person(ws, "alex", "editor");
  const b = person(ws, "bea", "editor");
  const postId = await createDocument(a, "post", { title: "Draft" });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? editDraft(a, "post", postId, { title: `title ${i}` })
        : editDraft(b, "post", postId, { summary: `summary ${i}` })
    )
  );
  const draft = await a.postDraft.findUnique({ where: { id: postId } });
  assert.match(draft.title, /^title \d$/);
  assert.match(draft.summary, /^summary \d$/);
});

test("baseline without a lock: two edits to one rich-text body, one is lost", async () => {
  const ws = dataset();
  const a = person(ws, "alex", "editor");
  const b = person(ws, "bea", "editor");
  const noteId = await createDocument(a, "note", { text: doc("start") });
  // Both read the same body and each adds a paragraph.
  const base = (await a.noteDraft.findUnique({ where: { id: noteId } })).text;
  await Promise.all([
    editDraft(a, "note", noteId, { text: { ...base, content: [...base.content, para("from Alex")] } }),
    editDraft(b, "note", noteId, { text: { ...base, content: [...base.content, para("from Bea")] } }),
  ]);
  const final = texts((await a.noteDraft.findUnique({ where: { id: noteId } })).text);
  assert.equal(final.length, 2, `last write wins on the whole body: ${final}`);
  assert.equal(final.filter((t) => t.startsWith("from ")).length, 1, "exactly one of the two edits survived");
});

test("with a field lock: the second editor is refused until the first releases, and no edit is lost", async () => {
  const ws = dataset();
  const a = person(ws, "alex", "editor");
  const b = person(ws, "bea", "editor");
  const postId = await createDocument(a, "post", { title: "Locked", body: doc("start") });

  await takeLock(a, "post", postId, "body", "alex");
  const base = (await a.postDraft.findUnique({ where: { id: postId } })).body;
  await editDraft(a, "post", postId, { body: { ...base, content: [...base.content, para("from Alex")] } });

  // Bea cannot take the lock, cannot write the body, cannot release Alex's lock.
  assert.equal((await refused(takeLock(b, "post", postId, "body", "bea"))).code, "permission_denied");
  assert.equal((await refused(editDraft(b, "post", postId, { body: doc("overwrite") }))).code, "permission_denied");
  assert.equal((await refused(releaseLock(b, "post", postId, "body"))).code, "permission_denied");
  // A lock cannot be taken in someone else's name, nor for longer than LOCK_MS.
  const c = person(ws, "cy", "editor");
  const other = await createDocument(c, "post", { title: "Other", body: doc("x") });
  assert.equal((await refused(takeLock(c, "post", other, "body", "cy", Date.now() + 3_600_000))).code, "permission_denied");
  assert.equal((await refused(takeLock(b, "post", postId, "body", "alex"))).code, "permission_denied");
  // Other fields stay open while the body is locked.
  await editDraft(b, "post", postId, { summary: "Bea's summary" });

  await releaseLock(a, "post", postId, "body");
  await takeLock(b, "post", postId, "body", "bea");
  const current = (await b.postDraft.findUnique({ where: { id: postId } })).body;
  await editDraft(b, "post", postId, { body: { ...current, content: [...current.content, para("from Bea")] } });
  await releaseLock(b, "post", postId, "body");

  const draft = await a.postDraft.findUnique({ where: { id: postId } });
  assert.deepEqual(texts(draft.body), ["start", "from Alex", "from Bea"]);
  assert.equal(draft.summary, "Bea's summary");
  assert.equal(draft.bodyLockedBy, null);
});

test("concurrent attempts to take one lock: exactly one editor gets it", async () => {
  const ws = dataset();
  const editors = ["alex", "bea", "cy", "dee"].map((sub) => ({ sub, db: person(ws, sub, "editor") }));
  const postId = await createDocument(editors[0].db, "post", { title: "Race", body: doc("start") });
  const results = await Promise.allSettled(editors.map(({ sub, db }) => takeLock(db, "post", postId, "body", sub)));
  const winners = editors.filter((_, i) => results[i].status === "fulfilled").map((e) => e.sub);
  assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal((await editors[0].db.postDraft.findUnique({ where: { id: postId } })).bodyLockedBy, winners[0]);
});

test("an expired lock can be taken over", async () => {
  const ws = dataset();
  const a = person(ws, "alex", "editor");
  const b = person(ws, "bea", "editor");
  const postId = await createDocument(a, "post", { title: "Expiry", body: doc("start") });
  // Alex's lock runs out 1.5 s from now (an editor who closed the tab).
  await takeLock(a, "post", postId, "body", "alex", Date.now() - LOCK_MS + 1500);
  await refused(takeLock(b, "post", postId, "body", "bea"));
  await new Promise((r) => setTimeout(r, 2500));
  await takeLock(b, "post", postId, "body", "bea");
  // Alex's expired lock no longer lets him write.
  await refused(editDraft(a, "post", postId, { body: doc("late") }));
  assert.equal((await b.postDraft.findUnique({ where: { id: postId } })).bodyLockedBy, "bea");
});
