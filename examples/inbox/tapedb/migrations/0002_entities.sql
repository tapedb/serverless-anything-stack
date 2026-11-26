CREATE TABLE IF NOT EXISTS "contact" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "email" TEXT
);

CREATE INDEX IF NOT EXISTS "contact_email_idx" ON "contact" ("email");

CREATE TABLE IF NOT EXISTS "conversation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "subject" TEXT,
  "status" TEXT DEFAULT 'open',
  "assignee_id" TEXT,
  "last_read_at" REAL DEFAULT 0,
  "contact_id" TEXT REFERENCES "contact"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "conversation_status_idx" ON "conversation" ("status");

CREATE INDEX IF NOT EXISTS "conversation_assignee_id_idx" ON "conversation" ("assignee_id");

CREATE INDEX IF NOT EXISTS "conversation_contact_id_idx" ON "conversation" ("contact_id");

CREATE TABLE IF NOT EXISTS "message" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "updated_seq" INTEGER NOT NULL DEFAULT 0,
  "body" TEXT,
  "sender" TEXT,
  "sent_at" REAL,
  "conversation_id" TEXT REFERENCES "conversation"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "message_sender_idx" ON "message" ("sender");

CREATE INDEX IF NOT EXISTS "message_sent_at_idx" ON "message" ("sent_at");

CREATE INDEX IF NOT EXISTS "message_conversation_id_idx" ON "message" ("conversation_id");