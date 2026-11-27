/**
 * Document operations on the compiled models: what a Studio calls. Each one is
 * one TapeDB transaction in the dataset's workspace.
 */
import { id } from "@tapedb/tapedb";
import { column, type ContentTypes, LOCK_MS } from "./content.ts";

/** A client; `sub` is the caller's subject, written into revisions as `by`. */
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

const pick = (types: ContentTypes, type: string, row: Record<string, unknown>) =>
  Object.fromEntries(contentColumns(types, type).map((c) => [c, row[c] ?? null]));

/** The writes that publish `values` as revision `baseRev + 1`, with its revision row. */
function publishWrites(db: Db, type: string, docId: string, values: Record<string, unknown>, baseRev: number, at: number) {
  return [
    db[type].update({ where: { id: docId }, data: { ...values, rev: baseRev + 1, publishedAt: at } }),
    db[`${type}Revision`].create({ data: { documentId: docId, rev: baseRev + 1, values, publishedAt: at, by: db.sub } }),
  ];
}

/**
 * Publishes the draft as revision `baseRev + 1`, records the revision and
 * removes the draft, in one transaction. Refused when the document moved past
 * `baseRev` (another publish landed) or when the result fails validation.
 */
export function publish(db: Db, types: ContentTypes, type: string, draft: Record<string, unknown>, baseRev: number, at = Date.now()) {
  const docId = draft.id as string;
  return db.$transaction([
    ...publishWrites(db, type, docId, pick(types, type, draft), baseRev, at),
    db[`${type}Draft`].delete({ where: { id: docId } }),
  ]);
}

/** Takes the document off the published read path; it stays for contributors. Recorded as a revision. */
export async function unpublish(db: Db, types: ContentTypes, type: string, docId: string, baseRev: number) {
  const doc = await db[type].findUnique({ where: { id: docId } });
  return db.$transaction([
    db[type].update({ where: { id: docId }, data: { publishedAt: null, rev: baseRev + 1 } }),
    db[`${type}Revision`].create({ data: { documentId: docId, rev: baseRev + 1, values: pick(types, type, doc), publishedAt: null, by: db.sub } }),
  ]);
}

/** The document's revisions, oldest first. */
export function revisions(db: Db, type: string, docId: string) {
  return db[`${type}Revision`].findMany({ where: { documentId: docId }, orderBy: { rev: "asc" } });
}

/** Replaces the draft with the values of an earlier revision, to review and publish. */
export async function restoreRevision(db: Db, type: string, docId: string, rev: number) {
  const [revision] = await db[`${type}Revision`].findMany({ where: { documentId: docId, rev } });
  if (!revision) throw new Error(`no revision ${rev}`);
  const existing = await db[`${type}Draft`].findUnique({ where: { id: docId } });
  return db.$transaction([
    ...(existing ? [db[`${type}Draft`].delete({ where: { id: docId } })] : []),
    db[`${type}Draft`].create({ data: { id: docId, documentId: docId, ...revision.values } }),
  ]);
}

export async function createRelease(db: Db, name: string) {
  const releaseId = id();
  await db.cmsRelease.create({ data: { id: releaseId, name } });
  return releaseId;
}

/** Puts a document's next values into a release. */
export function addToRelease(db: Db, type: string, releaseId: string, docId: string, values: Record<string, unknown>) {
  return db[`${type}Version`].create({ data: { releaseId, documentId: docId, ...values } });
}

/**
 * Publishes every version in the release, records a revision for each, removes
 * the versions and marks the release published: one transaction. A document
 * that moved after it was read refuses its update, and the whole release with it.
 */
export async function publishRelease(db: Db, types: ContentTypes, releaseId: string, at = Date.now()) {
  const writes: unknown[] = [];
  for (const type of Object.keys(types)) {
    const versions = await db[`${type}Version`].findMany({ where: { releaseId } });
    if (versions.length === 0) continue;
    const docs = await db[type].findMany({ where: { id: { in: versions.map((v: any) => v.documentId) } } });
    const revOf = new Map(docs.map((d: any) => [d.id, d.rev]));
    for (const v of versions) {
      writes.push(...publishWrites(db, type, v.documentId, pick(types, type, v), revOf.get(v.documentId) as number, at));
      writes.push(db[`${type}Version`].delete({ where: { id: v.id } }));
    }
  }
  writes.push(db.cmsRelease.update({ where: { id: releaseId }, data: { state: "published", publishedAt: at } }));
  return db.$transaction(writes);
}
