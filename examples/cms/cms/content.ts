/**
 * A small content-type language compiled into TapeDB models. Each content type
 * becomes two models:
 *
 *   <type>       the document: its published values, `rev` and `publishedAt`.
 *                Strong references point here, so a referenced document cannot
 *                be deleted while anything points at it.
 *   <type>Draft  the working copy, readable by editors only. It has its
 *                document's id, so there is at most one per document.
 *
 * Validation runs on the server, in check() rules inside the write's
 * transaction: a draft may be incomplete, a published document may not. Every
 * change to a document goes through `rev`: a write must carry row.rev + 1, so a
 * publish based on an older revision is refused (optimistic locking).
 *
 * Every publish and unpublish also writes a <type>Revision row in the same
 * transaction: an immutable snapshot of the published values, its rev and the
 * writer. A <type>Version row holds a document's values inside a release
 * (cmsRelease); publishing a release applies all its versions in one
 * transaction.
 *
 * Roles: users read published documents; members (contributors) also read
 * and write drafts and versions; editors publish; admins delete documents.
 *
 * Rich-text fields carry a field lock on the draft (`<field>LockedBy`,
 * `<field>LockedUntil`): a write to the field is refused unless the writer
 * holds an unexpired lock, and a lock is taken only when it is free, expired
 * or already the writer's.
 */
import { check, filter, model, role, t } from "@tapedb/tapedb/schema";

// Role levels (WORKSPACE_ROLE_LEVELS): readers are users, contributors are
// members (they write drafts and release versions), editors publish, admins delete.
const MEMBER = 2;
const EDITOR = 3;

type Base = { required?: boolean };
export type FieldDef =
  | ({ kind: "string"; max?: number; pattern?: RegExp } & Base)
  | ({ kind: "slug" } & Base)
  | ({ kind: "number"; min?: number; max?: number } & Base)
  | ({ kind: "richText"; lock?: boolean } & Base)
  | ({ kind: "reference"; to: string; weak?: boolean } & Base);

export const field = {
  string: (o: Omit<Extract<FieldDef, { kind: "string" }>, "kind"> = {}): FieldDef => ({ kind: "string", ...o }),
  slug: (o: Base = {}): FieldDef => ({ kind: "slug", ...o }),
  number: (o: Omit<Extract<FieldDef, { kind: "number" }>, "kind"> = {}): FieldDef => ({ kind: "number", ...o }),
  /** `lock: false` leaves the field without a lock (last write wins), as a baseline. */
  richText: (o: { lock?: boolean } & Base = {}): FieldDef => ({ kind: "richText", ...o }),
  reference: (to: string, o: { weak?: boolean } & Base = {}): FieldDef => ({ kind: "reference", to, ...o }),
};

export type ContentTypes = Record<string, Record<string, FieldDef>>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LOCK_MS = 30_000;

/** The stored column for a field: strong references store `<name>Id`, weak ones `<name>Ref`. */
export function column(name: string, def: FieldDef): string {
  if (def.kind !== "reference") return name;
  return def.weak ? `${name}Ref` : `${name}Id`;
}

/** Problems with a value set, or [] when it is valid. `complete` also requires required fields. */
export function validate(fields: Record<string, FieldDef>, values: Record<string, unknown>, complete: boolean): string[] {
  const problems: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    const v = values[column(name, def)];
    if (v === undefined || v === null || v === "") {
      if (complete && def.required) problems.push(`${name}: required`);
      continue;
    }
    if (def.kind === "string") {
      if (typeof v !== "string") problems.push(`${name}: not a string`);
      else {
        if (def.max !== undefined && v.length > def.max) problems.push(`${name}: longer than ${def.max}`);
        if (def.pattern && !def.pattern.test(v)) problems.push(`${name}: does not match ${def.pattern}`);
      }
    }
    if (def.kind === "slug" && (typeof v !== "string" || !SLUG.test(v))) problems.push(`${name}: not a slug`);
    if (def.kind === "number") {
      if (typeof v !== "number") problems.push(`${name}: not a number`);
      else {
        if (def.min !== undefined && v < def.min) problems.push(`${name}: below ${def.min}`);
        if (def.max !== undefined && v > def.max) problems.push(`${name}: above ${def.max}`);
      }
    }
    if (def.kind === "richText" && !Array.isArray((v as { content?: unknown }).content)) problems.push(`${name}: not a rich-text document`);
  }
  return problems;
}

function columns(fields: Record<string, FieldDef>, draft: boolean, locks = draft) {
  const out: Record<string, any> = {};
  for (const [name, def] of Object.entries(fields)) {
    switch (def.kind) {
      case "string":
        out[name] = t.string().optional();
        break;
      case "slug":
        // Published slugs are unique per type; drafts may collide while being edited.
        out[name] = draft ? t.string().optional().index() : t.string().optional().unique();
        break;
      case "number":
        out[name] = t.number().optional();
        break;
      case "richText":
        out[name] = t.json().optional();
        if (locks && def.lock !== false) {
          out[`${name}LockedBy`] = t.string().optional();
          out[`${name}LockedUntil`] = t.number().optional();
        }
        break;
      case "reference":
        // A strong reference is a foreign key that refuses the target's deletion.
        // A weak one is a plain id that may dangle, resolved at read time.
        out[def.weak ? `${name}Ref` : name] = def.weak
          ? t.string().optional().index()
          : t.belongsTo(def.to, { onDelete: "restrict" }).optional();
        break;
    }
  }
  return out;
}

const merged = (row: Record<string, unknown> | undefined, data: Record<string, unknown> | undefined) => ({ ...(row ?? {}), ...(data ?? {}) });

function documentRules(fields: Record<string, FieldDef>) {
  return {
    // Readers see published documents only; contributors and up see every document.
    read: filter(({ auth }) => (auth.role >= MEMBER ? {} : { publishedAt: { isNull: false } })),
    create: check(({ auth, data }) => {
      if ((data?.rev ?? 0) !== 0) return false;
      // A contributor creates unpublished documents; creating one published takes an editor and a complete document.
      if (data?.publishedAt == null) return auth.role >= MEMBER;
      return auth.role >= EDITOR && validate(fields, data ?? {}, true).length === 0;
    }),
    update: check(({ auth, row, data }) => {
      if (auth.role < EDITOR || !row) return false;
      // Every change advances rev by exactly one: a writer on an older revision is refused.
      if (data?.rev !== (row.rev as number) + 1) return false;
      const next = merged(row, data);
      return next.publishedAt == null || validate(fields, next, true).length === 0;
    }),
    delete: role("admin"),
  };
}

function draftRules(fields: Record<string, FieldDef>) {
  const locked = Object.entries(fields).filter(([, d]) => d.kind === "richText" && d.lock !== false).map(([n]) => n);
  return {
    read: role("member"),
    create: check(({ auth, data }) => auth.role >= MEMBER && validate(fields, data ?? {}, false).length === 0),
    update: check(({ auth, row, data, changed }) => {
      if (auth.role < MEMBER || !row) return false;
      const now = Date.now();
      for (const name of locked) {
        const by = `${name}LockedBy`;
        const until = `${name}LockedUntil`;
        const expired = row[until] == null || (row[until] as number) <= now;
        const mine = row[by] === auth.sub && !expired;
        const free = row[by] == null || expired || row[by] === auth.sub;
        // A lock lasts at most LOCK_MS (plus 5 s for clock skew), so no one can hold a field for good.
        const term = data?.[until] as number;
        const taking = changed?.includes(by) && data?.[by] === auth.sub && free && term > now && term <= now + LOCK_MS + 5_000;
        if (changed?.includes(by) || changed?.includes(until)) {
          // Take: only when free. Release (null): only the holder, or anyone once expired.
          if (data?.[by] == null ? !(mine || expired) : !taking) return false;
        }
        // Writing the field needs the lock, held already or taken in this write.
        if (changed?.includes(name) && !(mine || taking)) return false;
      }
      return validate(fields, merged(row, data), false).length === 0;
    }),
    delete: role("member"),
  };
}

const revisionRules = {
  read: role("member"),
  // Written by editors with each publish, in the writer's own name, and never changed.
  create: check(({ auth, data }) => auth.role >= EDITOR && data?.by === auth.sub),
  update: check(() => false),
  delete: role("admin"),
};

function versionRules(fields: Record<string, FieldDef>) {
  return {
    read: role("member"),
    create: check(({ auth, data }) => auth.role >= MEMBER && validate(fields, data ?? {}, false).length === 0),
    update: check(({ auth, row, data }) => auth.role >= MEMBER && !!row && validate(fields, merged(row, data), false).length === 0),
    delete: role("member"),
  };
}

const releaseRules = {
  read: role("member"),
  create: check(({ auth, data }) => auth.role >= MEMBER && (data?.state ?? "open") === "open"),
  // Only an open release changes, and only an editor publishes it, once.
  update: check(({ auth, row, data, changed }) => {
    if (!row || row.state !== "open") return false;
    if (changed?.includes("state")) return auth.role >= EDITOR && data?.state === "published" && typeof data?.publishedAt === "number";
    return auth.role >= MEMBER && !changed?.includes("publishedAt");
  }),
  delete: check(({ auth, row }) => auth.role >= MEMBER && row?.state === "open"),
};

/** Compiles content types into schema models. */
export function compile(types: ContentTypes) {
  const models: Record<string, any> = {};
  for (const [type, fields] of Object.entries(types)) {
    models[type] = model({
      ...columns(fields, false),
      rev: t.number().default(0),
      publishedAt: t.number().optional().index(),
    }).access(documentRules(fields));
    models[`${type}Draft`] = model({
      ...columns(fields, true),
      // The draft's id is its document's id, so a document has at most one draft.
      document: t.belongsTo(type, { onDelete: "cascade" }),
    }).access(draftRules(fields));
    models[`${type}Revision`] = model({
      document: t.belongsTo(type, { onDelete: "cascade" }),
      rev: t.number().index(),
      values: t.json(),
      publishedAt: t.number().optional(),
      by: t.string(),
    }).access(revisionRules);
    models[`${type}Version`] = model({
      ...columns(fields, true, false),
      release: t.belongsTo("cmsRelease", { onDelete: "cascade" }),
      document: t.belongsTo(type, { onDelete: "cascade" }),
    }).access(versionRules(fields));
  }
  models.cmsRelease = model({
    name: t.string(),
    state: t.enum(["open", "published"]).default("open").index(),
    publishedAt: t.number().optional(),
  }).access(releaseRules);
  return models;
}
