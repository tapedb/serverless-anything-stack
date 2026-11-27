CREATE TABLE IF NOT EXISTS "author" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "bio" TEXT,
  "rev" REAL DEFAULT 0,
  "published_at" REAL
);

CREATE INDEX IF NOT EXISTS "author_published_at_idx" ON "author" ("published_at");

CREATE TABLE IF NOT EXISTS "author_draft" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "bio" TEXT,
  "bio_locked_by" TEXT,
  "bio_locked_until" REAL,
  "document_id" TEXT REFERENCES "author"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "author_draft_document_id_idx" ON "author_draft" ("document_id");

CREATE TABLE IF NOT EXISTS "post" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT,
  "slug" TEXT,
  "summary" TEXT,
  "body" TEXT,
  "author_id" TEXT REFERENCES "author"("id") ON DELETE RESTRICT,
  "related_ref" TEXT,
  "rev" REAL DEFAULT 0,
  "published_at" REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_slug_idx" ON "post" ("slug");

CREATE INDEX IF NOT EXISTS "post_author_id_idx" ON "post" ("author_id");

CREATE INDEX IF NOT EXISTS "post_related_ref_idx" ON "post" ("related_ref");

CREATE INDEX IF NOT EXISTS "post_published_at_idx" ON "post" ("published_at");

CREATE TABLE IF NOT EXISTS "post_draft" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT,
  "slug" TEXT,
  "summary" TEXT,
  "body" TEXT,
  "body_locked_by" TEXT,
  "body_locked_until" REAL,
  "author_id" TEXT REFERENCES "author"("id") ON DELETE RESTRICT,
  "related_ref" TEXT,
  "document_id" TEXT REFERENCES "post"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "post_draft_slug_idx" ON "post_draft" ("slug");

CREATE INDEX IF NOT EXISTS "post_draft_author_id_idx" ON "post_draft" ("author_id");

CREATE INDEX IF NOT EXISTS "post_draft_related_ref_idx" ON "post_draft" ("related_ref");

CREATE INDEX IF NOT EXISTS "post_draft_document_id_idx" ON "post_draft" ("document_id");

CREATE TABLE IF NOT EXISTS "note" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "text" TEXT,
  "rev" REAL DEFAULT 0,
  "published_at" REAL
);

CREATE INDEX IF NOT EXISTS "note_published_at_idx" ON "note" ("published_at");

CREATE TABLE IF NOT EXISTS "note_draft" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "text" TEXT,
  "document_id" TEXT REFERENCES "note"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "note_draft_document_id_idx" ON "note_draft" ("document_id");