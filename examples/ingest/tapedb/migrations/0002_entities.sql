CREATE TABLE IF NOT EXISTS "issue" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "fingerprint" TEXT,
  "title" TEXT,
  "level" TEXT DEFAULT 'error',
  "status" TEXT DEFAULT 'unresolved',
  "first_seen" REAL,
  "last_seen" REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS "issue_fingerprint_idx" ON "issue" ("fingerprint");

CREATE INDEX IF NOT EXISTS "issue_level_idx" ON "issue" ("level");

CREATE INDEX IF NOT EXISTS "issue_status_idx" ON "issue" ("status");

CREATE INDEX IF NOT EXISTS "issue_last_seen_idx" ON "issue" ("last_seen");

CREATE TABLE IF NOT EXISTS "tally" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "count" REAL,
  "issue_id" TEXT REFERENCES "issue"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tally_issue_id_idx" ON "tally" ("issue_id");

CREATE TABLE IF NOT EXISTS "dead_letter" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "body" TEXT,
  "attempts" REAL
);