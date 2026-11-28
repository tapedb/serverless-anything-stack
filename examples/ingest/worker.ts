/**
 * Ingest fixture (recipes: ingestion, async).
 *
 *   POST /api/<project>/envelope/   Sentry envelope; 200 only after the event is on the queue
 *   queue "events"                  grouping consumer: issue upserts + one tally per message
 *   queue "events-dlq"              records what could not be grouped, in the workspace
 *
 * TapeDB is reached through its admin HTTP API (/v1/transact) on this same
 * Worker, acting as a named ingest identity: the rules apply as for any client.
 */
import { defineTapeDB } from "@tapedb/tapedb/worker";
import schema from "./tapedb.schema";
import { migrations } from "./tapedb/migrations.gen";

interface Env {
  EVENTS: Queue<IngestMessage>;
  /** JSON: { "<project key>": "<organization workspace uuid>" } */
  PROJECTS: string;
  TAPEDB_API_TOKEN: string;
  [binding: string]: unknown;
}

interface IngestMessage {
  workspace: string;
  receivedAt: number;
  /** The envelope's event item, as received. Parsed by the consumer, not the edge. */
  event: string;
}

const tapedb = defineTapeDB({
  schema,
  migrations,
  devClaims: true,
  http: { token: (env) => (env as unknown as Env).TAPEDB_API_TOKEN },
});

export const WorkspaceRoom = tapedb.WorkspaceRoom;

const INGEST = { sub: "ingest", role: 6 }; // OWNER: the ingest service writes issues for the org
const MAX_ENVELOPE_BYTES = 1_000_000;

function projectKey(request: Request, url: URL): string | null {
  const header = request.headers.get("x-sentry-auth") ?? "";
  const fromHeader = /sentry_key=([^,\s]+)/.exec(header)?.[1];
  return fromHeader ?? url.searchParams.get("sentry_key");
}

/** Envelope: a header line, then (item header line, payload line) pairs. */
function eventItems(body: string): string[] {
  const lines = body.split("\n");
  const events: string[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    let type: unknown;
    try { type = JSON.parse(lines[i]).type; } catch { continue; }
    if (type === "event") events.push(lines[i + 1]);
  }
  return events;
}

async function ingest(request: Request, env: Env, project: string, url: URL): Promise<Response> {
  const projects = JSON.parse(env.PROJECTS) as Record<string, string>;
  const key = projectKey(request, url);
  const workspace = key ? projects[key] : undefined;
  if (!workspace) return Response.json({ error: "unknown_project_key" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ENVELOPE_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_ENVELOPE_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  const events = eventItems(body);
  if (events.length === 0) return Response.json({ error: "no_event" }, { status: 400 });
  // Acknowledge only once the queue has the events: send() resolves after the
  // queue durably accepted them, so a 200 means nothing is lost if we crash now.
  await env.EVENTS.sendBatch(events.map((event) => ({ body: { workspace, receivedAt: Date.now(), event } })));
  return Response.json({ ok: true, project, accepted: events.length });
}

/** Sentry-style grouping, simplified: exception type and value with numbers removed, else the message. */
export function fingerprint(event: Record<string, any>): { fingerprint: string; title: string; level: string } {
  if (Array.isArray(event.fingerprint) && event.fingerprint.length) {
    return { fingerprint: event.fingerprint.join("|"), title: String(event.message ?? event.fingerprint.join(" ")), level: event.level ?? "error" };
  }
  const ex = event.exception?.values?.at?.(-1);
  if (ex?.type) {
    const value = String(ex.value ?? "").replace(/\d+/g, "<n>");
    return { fingerprint: `exc|${ex.type}|${value}`, title: `${ex.type}: ${ex.value ?? ""}`.trim(), level: event.level ?? "error" };
  }
  const message = typeof event.message === "string" ? event.message : event.message?.formatted;
  if (typeof message === "string" && message) {
    return { fingerprint: `msg|${message.replace(/\d+/g, "<n>")}`, title: message, level: event.level ?? "info" };
  }
  throw new Error("event has neither an exception nor a message");
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function transact(env: Env, ctx: ExecutionContext, workspace: string, writes: unknown[], clientTxId?: string) {
  const response = await tapedb.worker.fetch(
    new Request("https://ingest.internal/v1/transact", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TAPEDB_API_TOKEN}` },
      body: JSON.stringify({ workspace, as: INGEST, writes, ...(clientTxId ? { clientTxId } : {}) }),
    }),
    env as never,
    ctx
  );
  if (!response.ok) throw new Error(`transact ${response.status}: ${await response.text()}`);
}

async function group(batch: MessageBatch<IngestMessage>, env: Env, ctx: ExecutionContext) {
  // Per message, so one poison event fails alone: its siblings are acked.
  for (const message of batch.messages) {
    try {
      const { workspace, receivedAt, event } = message.body;
      const parsed = JSON.parse(event) as Record<string, any>;
      const { fingerprint: fp, title, level: rawLevel } = fingerprint(parsed);
      const level = ["fatal", "error", "warning", "info", "debug"].includes(rawLevel) ? rawLevel : "error";
      const issueId = `iss_${await sha(fp)}`;
      await transact(env, ctx, workspace, [
        {
          op: "upsert",
          namespace: "issue",
          id: issueId,
          values: { lastSeen: receivedAt },
          // /v1/transact takes the wire ops as they are: schema defaults are the
          // typed client's job, so every defaulted field is spelled out here.
          create: { fingerprint: fp, title: title.slice(0, 500), level, status: "unresolved", firstSeen: receivedAt, lastSeen: receivedAt },
        },
        // Keyed by the queue message id: a redelivery writes the same row again.
        { op: "upsert", namespace: "tally", id: `tly_${message.id}`, values: { count: 1, issueId }, create: { count: 1, issueId } },
      ]);
      // Fixture only: fail after the write on the first attempt, so the queue
      // redelivers a message whose tally is already stored.
      if (parsed.extra?.fixtureFailAfterWrite && message.attempts === 1) throw new Error("fixture: failing after the write");
      message.ack();
    } catch (error) {
      console.warn(JSON.stringify({ event: "group_failed", id: message.id, attempts: message.attempts, error: String(error) }));
      message.retry();
    }
  }
}

async function deadLetters(batch: MessageBatch<IngestMessage>, env: Env, ctx: ExecutionContext) {
  for (const message of batch.messages) {
    const { workspace, event } = message.body;
    await transact(env, ctx, workspace, [
      { op: "upsert", namespace: "deadLetter", id: `dl_${message.id}`, values: { reason: "grouping failed after retries", body: String(event).slice(0, 2000), attempts: message.attempts }, create: { reason: "grouping failed after retries", body: String(event).slice(0, 2000), attempts: message.attempts } },
    ]);
    message.ack();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/api\/([^/]+)\/envelope\/?$/.exec(url.pathname);
    if (match && request.method === "POST") return ingest(request, env, match[1], url);
    return tapedb.worker.fetch(request, env as never, ctx);
  },
  async queue(batch: MessageBatch<IngestMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    if (batch.queue === "events-dlq") return deadLetters(batch, env, ctx);
    return group(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, IngestMessage>;
