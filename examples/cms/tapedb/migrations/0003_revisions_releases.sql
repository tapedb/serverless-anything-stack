CREATE TABLE IF NOT EXISTS "author_revision" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "document_id" TEXT REFERENCES "author"("id") ON DELETE CASCADE,
  "rev" REAL,
  "values" TEXT,
  "published_at" REAL,
  "by" TEXT
);
CREATE INDEX IF NOT EXISTS "author_revision_document_id_idx" ON "author_revision" ("document_id");
CREATE INDEX IF NOT EXISTS "author_revision_rev_idx" ON "author_revision" ("rev");
CREATE TABLE IF NOT EXISTS "author_version" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "bio" TEXT,
  "release_id" TEXT REFERENCES "cms_release"("id") ON DELETE CASCADE,
  "document_id" TEXT REFERENCES "author"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "author_version_release_id_idx" ON "author_version" ("release_id");
CREATE INDEX IF NOT EXISTS "author_version_document_id_idx" ON "author_version" ("document_id");
CREATE TABLE IF NOT EXISTS "post_revision" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "document_id" TEXT REFERENCES "post"("id") ON DELETE CASCADE,
  "rev" REAL,
  "values" TEXT,
  "published_at" REAL,
  "by" TEXT
);
CREATE INDEX IF NOT EXISTS "post_revision_document_id_idx" ON "post_revision" ("document_id");
CREATE INDEX IF NOT EXISTS "post_revision_rev_idx" ON "post_revision" ("rev");
CREATE TABLE IF NOT EXISTS "post_version" (
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
  "release_id" TEXT REFERENCES "cms_release"("id") ON DELETE CASCADE,
  "document_id" TEXT REFERENCES "post"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "post_version_slug_idx" ON "post_version" ("slug");
CREATE INDEX IF NOT EXISTS "post_version_author_id_idx" ON "post_version" ("author_id");
CREATE INDEX IF NOT EXISTS "post_version_related_ref_idx" ON "post_version" ("related_ref");
CREATE INDEX IF NOT EXISTS "post_version_release_id_idx" ON "post_version" ("release_id");
CREATE INDEX IF NOT EXISTS "post_version_document_id_idx" ON "post_version" ("document_id");
CREATE TABLE IF NOT EXISTS "note_revision" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "document_id" TEXT REFERENCES "note"("id") ON DELETE CASCADE,
  "rev" REAL,
  "values" TEXT,
  "published_at" REAL,
  "by" TEXT
);
CREATE INDEX IF NOT EXISTS "note_revision_document_id_idx" ON "note_revision" ("document_id");
CREATE INDEX IF NOT EXISTS "note_revision_rev_idx" ON "note_revision" ("rev");
CREATE TABLE IF NOT EXISTS "note_version" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "text" TEXT,
  "release_id" TEXT REFERENCES "cms_release"("id") ON DELETE CASCADE,
  "document_id" TEXT REFERENCES "note"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "note_version_release_id_idx" ON "note_version" ("release_id");
CREATE INDEX IF NOT EXISTS "note_version_document_id_idx" ON "note_version" ("document_id");
CREATE TABLE IF NOT EXISTS "cms_release" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "state" TEXT DEFAULT 'open',
  "published_at" REAL
);
CREATE INDEX IF NOT EXISTS "cms_release_state_idx" ON "cms_release" ("state");
