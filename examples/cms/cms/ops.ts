/**
 * Document operations on the compiled models: what a Studio calls. Each one is
 * one TapeDB transaction in the dataset's workspace.
 */
import { id } from "@tapedb/tapedb";
import { column, type ContentTypes, LOCK_MS } from "./content.ts";

type Db = any;

function contentColumns(types: ContentTypes, type: string): string[] {
  return Object.entries(types[type]).map(([name, def]) => column(name, def));
}

/** A new document (unpublished, rev 0) and its draft, sharing one id. */
export async function createDocument(db: Db, type: string, values: Record<string, unknown>) {
  const docId = id();
  await db.$transaction([
    db[type].create({ data: { id: docId, rev: 0 } }),
    db[`${type}Draft`].create({ data: { id: docId, documentId: docId, ...values } }),
  ]);
  return docId;
}

/** Opens a draft from the published values when the document has none. */
export async function ensureDraft(db: Db, types: ContentTypes, type: string, docId: string) {
  const existing = await db[`${type}Draft`].findUnique({ where: { id: docId } });
  if (existing) return existing;
  const doc = await db[type].findUnique({ where: { id: docId } });
  const values = Object.fromEntries(contentColumns(types, type).map((c) => [c, doc[c] ?? null]));
  await db[`${type}Draft`].create({ data: { id: docId, documentId: docId, ...values } });
  return db[`${type}Draft`].findUnique({ where: { id: docId } });
}

/** Writes draft fields. Rich-text fields need the lock (takeLock), or the write is refused. */
export function editDraft(db: Db, type: string, docId: string, values: Record<string, unknown>) {
  return db[`${type}Draft`].update({ where: { id: docId }, data: values });
}

export function takeLock(db: Db, type: string, docId: string, fieldName: string, sub: string, now = Date.now()) {
  return db[`${type}Draft`].update({
    where: { id: docId },
    data: { [`${fieldName}LockedBy`]: sub, [`${fieldName}LockedUntil`]: now + LOCK_MS },
  });
}

export function releaseLock(db: Db, type: string, docId: string, fieldName: string) {
  return db[`${type}Draft`].update({ where: { id: docId }, data: { [`${fieldName}LockedBy`]: null, [`${fieldName}LockedUntil`]: null } });
}

/**
 * Publishes the draft as revision `baseRev + 1` and removes the draft, in one
 * transaction. Refused when the document moved past `baseRev` (another publish
 * landed) or when the result fails validation.
 */
export function publish(db: Db, types: ContentTypes, type: string, draft: Record<string, unknown>, baseRev: number, at = Date.now()) {
  const docId = draft.id as string;
  const values = Object.fromEntries(contentColumns(types, type).map((c) => [c, draft[c] ?? null]));
  return db.$transaction([
    db[type].update({ where: { id: docId }, data: { ...values, rev: baseRev + 1, publishedAt: at } }),
    db[`${type}Draft`].delete({ where: { id: docId } }),
  ]);
}

/** Takes the document off the published read path; it stays for editors. */
export function unpublish(db: Db, type: string, docId: string, baseRev: number) {
  return db[type].update({ where: { id: docId }, data: { publishedAt: null, rev: baseRev + 1 } });
}
