// Inbox fixture (Chatwoot case) against `tapedb dev`: workerd, a real
// WorkspaceRoom per account, the real client over its socket.
//
//   npm test
//
// Covers t.fixture-inbox and t.fixture-isolation in cases/chatwoot.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@tapedb/tapedb";
import schema from "../tapedb.schema.ts";

const PORT = 8792;
const URL = `http://localhost:${PORT}`;
let dev;

before(async () => {
  dev = spawn("npx", ["--no-install", "tapedb-cli", "dev", "--port", String(PORT)], {
    cwd: new globalThis.URL("..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const r = await fetch(`${URL}/_tapedb/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: randomUUID() }),
      });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`tapedb dev did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  try { process.kill(-dev.pid, "SIGTERM"); } catch {}
});

const clients = [];
function account(workspace = randomUUID(), options = {}) {
  const db = createClient({ schema, url: URL, workspace, ...options });
  clients.push(db);
  return { db, workspace };
}
after(() => { for (const db of clients) db.$close(); });

const claim = async (workspaceId) =>
  (await (await fetch(`${URL}/_tapedb/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) })).json()).token;

async function unread(db, conversationId) {
  const c = await db.conversation.findUnique({ where: { id: conversationId } });
  return db.message.count({ where: { conversationId, sender: "contact", sentAt: { gt: c.lastReadAt } } });
}

test("a conversation with messages, read and unread", async () => {
  const { db } = account();
  const { id: conversationId } = await db.conversation.create({
    data: {
      subject: "Order 1042 missing",
      contact: { create: { name: "Ada", email: "ada@example.test" } },
      messages: { create: [1, 2, 3].map((i) => ({ body: `m${i}`, sender: "contact", sentAt: 1000 + i })) },
    },
  });
  assert.equal(await unread(db, conversationId), 3);

  // The agent opens it: everything up to now is read.
  await db.conversation.update({ where: { id: conversationId }, data: { lastReadAt: 1003, assigneeId: "agent-1" } });
  assert.equal(await unread(db, conversationId), 0);

  // An agent reply never counts as unread; a new contact message does.
  await db.message.create({ data: { body: "On it", sender: "agent", sentAt: 1004, conversation: { connect: conversationId } } });
  await db.message.create({ data: { body: "Thanks", sender: "contact", sentAt: 1005, conversation: { connect: conversationId } } });
  assert.equal(await unread(db, conversationId), 1);

  const assigned = await db.conversation.findMany({ where: { assigneeId: "agent-1", status: "open" } });
  assert.deepEqual(assigned.map((c) => c.id), [conversationId]);
});

test("an agent's live unread count follows a contact's message from another client", async () => {
  const { db: agent, workspace } = account();
  const { db: widget } = account(workspace);
  const { id: conversationId } = await agent.conversation.create({ data: { subject: "Live", contact: { create: { name: "Bo" } } } });

  const seen = [];
  let resolveTwo;
  const two = new Promise((r) => (resolveTwo = r));
  const stop = agent.message
    .count({ where: { conversationId, sender: "contact" } })
    .subscribe(({ data }) => {
      if (typeof data === "number") seen.push(data);
      if (data === 2) resolveTwo();
    });
  await widget.message.create({ data: { body: "hello?", sender: "contact", sentAt: 1, conversation: { connect: conversationId } } });
  await widget.message.create({ data: { body: "anyone?", sender: "contact", sentAt: 2, conversation: { connect: conversationId } } });
  await Promise.race([two, new Promise((_, no) => setTimeout(() => no(new Error(`live count stalled at ${seen.join(",")}`)), 10_000))]);
  stop();
  assert.equal(seen.at(-1), 2);
});

test("concurrent sends into one conversation all land, none lost", async () => {
  const { db, workspace } = account();
  const { id: conversationId } = await db.conversation.create({ data: { subject: "Busy", contact: { create: { name: "Cy" } } } });
  const senders = [account(workspace).db, account(workspace).db, account(workspace).db];
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      senders[i % 3].message.create({ data: { body: `burst ${i}`, sender: "contact", sentAt: 2000 + i, conversation: { connect: conversationId } } })
    )
  );
  const rows = await db.message.findMany({ where: { conversationId }, orderBy: { sentAt: "asc" } });
  assert.equal(rows.length, 30);
  assert.deepEqual(rows.map((r) => r.body), Array.from({ length: 30 }, (_, i) => `burst ${i}`));
});

test("one account cannot read another's conversations", async () => {
  const a = account();
  await a.db.conversation.create({ data: { subject: "A's secret", contact: { create: { name: "Dee" } } } });
  const b = account();

  // B's own claim, presented to A's workspace: the claim names B's workspace.
  const bToken = await claim(b.workspace);
  const intruder = createClient({ schema, url: URL, workspace: a.workspace, getToken: async () => bToken });
  clients.push(intruder);
  await assert.rejects(intruder.conversation.findMany({}), (error) => {
    assert.equal(error.code, "wrong_workspace");
    assert.equal(error.status, 403);
    return true;
  });

  // And B's own workspace holds nothing of A's.
  assert.equal(await b.db.conversation.count({}), 0);
});
