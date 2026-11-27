// t.fixture-content-model (cases/sanity): content types compile to models,
// validation runs on the server, strong references hold, weak ones may dangle,
// and an additive change to a content type generates a migration that needs no
// data-loss flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claim, dataset, doc, person, refused, startDev, URL } from "./harness.mjs";
import { contentTypes } from "../tapedb.schema.ts";
import { createDocument, publish, takeLock } from "../cms/ops.ts";

startDev();

const root = new globalThis.URL("..", import.meta.url).pathname;

async function publishedAuthor(db, name = "Ada") {
  const authorId = await createDocument(db, "author", { name });
  await publish(db, contentTypes, "author", await db.authorDraft.findUnique({ where: { id: authorId } }), 0);
  return authorId;
}

test("each content type compiles to a document model and a draft model", async () => {
  const ws = dataset();
  const token = await claim(ws, "ed", "editor");
  const res = await fetch(`${URL}/engine/workspaces/${ws}/schema`, { headers: { authorization: `Bearer ${token}` } });
  const { data } = await res.json();
  const names = data.namespaces.map((n) => n.apiName).sort();
  assert.deepEqual(names, ["author", "authorDraft", "note", "noteDraft", "post", "postDraft"]);
  const post = data.namespaces.find((n) => n.apiName === "post");
  assert.deepEqual(Object.keys(post.attributes).sort(), ["authorId", "body", "publishedAt", "relatedRef", "rev", "slug", "summary", "title"].sort());
  assert.equal(post.attributes.slug.unique, true);
  const draft = data.namespaces.find((n) => n.apiName === "postDraft");
  assert.ok("bodyLockedBy" in draft.attributes && "bodyLockedUntil" in draft.attributes);
  const link = data.links.find((l) => l.apiName === "post.author");
  assert.equal(link.foreignKey.onDelete, "RESTRICT", "the strong reference restricts deletes");
  assert.equal(data.links.find((l) => l.apiName === "postDraft.document").foreignKey.onDelete, "CASCADE");
});

test("a draft may be incomplete; publishing an incomplete or invalid document is refused by the server", async () => {
  const db = person(dataset(), "ed", "editor");
  const authorId = await publishedAuthor(db);

  // Incomplete drafts are fine: an editor works on them over time.
  const postId = await createDocument(db, "post", { title: "Hello" });
  const draft = await db.postDraft.findUnique({ where: { id: postId } });
  assert.equal(draft.title, "Hello");

  // Publishing without slug, body and author: refused inside the transaction.
  const incomplete = await refused(publish(db, contentTypes, "post", draft, 0));
  assert.equal(incomplete.code, "permission_denied");

  // The same write sent straight at the model, bypassing ops.ts, is refused too.
  const direct = await refused(db.post.update({ where: { id: postId }, data: { title: "Hello", rev: 1, publishedAt: Date.now() } }));
  assert.equal(direct.code, "permission_denied");

  // A field constraint holds on drafts as well: no 121-character title.
  assert.equal((await refused(db.postDraft.update({ where: { id: postId }, data: { title: "x".repeat(121) } }))).code, "permission_denied");

  // An invalid slug cannot be published.
  const bad = { ...draft, slug: "Not A Slug", body: doc("Body"), authorId };
  assert.equal((await refused(publish(db, contentTypes, "post", bad, 0))).code, "permission_denied");

  // Complete and valid: lands.
  // body is a rich-text field: writing it needs its lock, taken in the same write here.
  await takeLock(db, "post", postId, "body", "ed");
  await db.postDraft.update({ where: { id: postId }, data: { slug: "hello", body: doc("Body"), authorId } });
  await publish(db, contentTypes, "post", await db.postDraft.findUnique({ where: { id: postId } }), 0);
  const published = await db.post.findUnique({ where: { id: postId } });
  assert.equal(published.rev, 1);
  assert.equal(published.slug, "hello");
  assert.deepEqual(published.body, doc("Body"));
});

test("published slugs are unique per type", async () => {
  const db = person(dataset(), "ed", "editor");
  const authorId = await publishedAuthor(db);
  const values = { title: "A", slug: "same", body: doc("a"), authorId };
  const first = await createDocument(db, "post", values);
  await publish(db, contentTypes, "post", await db.postDraft.findUnique({ where: { id: first } }), 0);
  const second = await createDocument(db, "post", { ...values, title: "B" });
  await refused(publish(db, contentTypes, "post", await db.postDraft.findUnique({ where: { id: second } }), 0));
  assert.equal((await db.post.findMany({ where: { slug: "same" } })).length, 1);
});

test("a strong reference refuses the target's deletion; a weak one may dangle", async () => {
  const ws = dataset();
  const db = person(ws, "ed", "editor");
  const admin = person(ws, "ad", "admin");
  const authorId = await publishedAuthor(db);
  const missing = "01a00000-0000-7000-8000-000000000000";
  const postId = await createDocument(db, "post", { title: "T", slug: "t", body: doc("b"), authorId, relatedRef: missing });
  await publish(db, contentTypes, "post", await db.postDraft.findUnique({ where: { id: postId } }), 0);

  await refused(admin.author.delete({ where: { id: authorId } }));
  assert.ok(await db.author.findUnique({ where: { id: authorId } }), "the author is still there");

  // The weak reference points at nothing and resolves to null at read time.
  const post = await db.post.findUnique({ where: { id: postId } });
  assert.equal(post.relatedRef, missing);
  assert.equal(await db.post.findUnique({ where: { id: post.relatedRef } }), null);

  // A strong reference to a document that does not exist is refused.
  await refused(db.postDraft.create({ data: { id: missing, documentId: postId, title: "x", authorId: missing } }));
});

test("an additive change to a content type generates a migration with no data-loss flag; a removal needs one", () => {
  const dir = mkdtempSync(join(tmpdir(), "cms-migrate-"));
  try {
    for (const entry of ["cms", "tapedb", "tapedb.schema.ts", "package.json", "wrangler.jsonc", "worker.ts"]) cpSync(join(root, entry), join(dir, entry), { recursive: true });
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    const schemaPath = join(dir, "tapedb.schema.ts");
    const original = readFileSync(schemaPath, "utf8");
    writeFileSync(schemaPath, original.replace('summary: field.string({ max: 280 }),', 'summary: field.string({ max: 280 }),\n    subtitle: field.string({ max: 120 }),'));
    const run = (args) => execFileSync("npx", ["--no-install", "tapedb-cli", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    run(["migrate", "dev", "--name", "add_subtitle"]);
    const file = readdirSync(join(dir, "tapedb", "migrations")).find((f) => f.includes("add_subtitle"));
    assert.ok(file, "a migration file was written");
    const sql = readFileSync(join(dir, "tapedb", "migrations", file), "utf8");
    assert.match(sql, /ALTER TABLE "post" ADD COLUMN "subtitle"/);
    assert.match(sql, /ALTER TABLE "post_draft" ADD COLUMN "subtitle"/);
    assert.doesNotMatch(sql, /DROP/);

    // Removing the field again is a drop: refused without --accept-data-loss.
    writeFileSync(schemaPath, original);
    let refusedDrop = false;
    try { run(["migrate", "dev", "--name", "drop_subtitle"]); } catch (e) { refusedDrop = /accept-data-loss/.test(String(e.stderr ?? "") + String(e.stdout ?? "")); }
    assert.ok(refusedDrop, "a drop needs --accept-data-loss");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
