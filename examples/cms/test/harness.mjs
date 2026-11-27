// Starts `tapedb dev` for the CMS fixture and makes clients with a chosen
// subject and role through the development claim route.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before } from "node:test";
import { createClient, WORKSPACE_ROLE_LEVELS } from "@tapedb/tapedb";
import schema from "../tapedb.schema.ts";

export const PORT = Number(process.env.CMS_PORT ?? 8793);
/** A deployment's URL (scripts/deployed.mjs), or tapedb dev on PORT. */
export const URL = process.env.CMS_URL ?? `http://localhost:${PORT}`;
export const DEPLOYED = Boolean(process.env.CMS_URL);
/** The webhook secret: wrangler.jsonc's local value, or the deployment's. */
/** A deployment's development claim route answers only with this run's token. */
const devTokenHeader = process.env.CMS_DEV_TOKEN ? { "x-tapedb-dev-token": process.env.CMS_DEV_TOKEN } : {};
export const HOOK_SECRET = process.env.CMS_HOOK_SECRET ?? "local-hook-secret-not-for-deployment";

export function startDev() {
  let dev;
  before(async () => {
    if (DEPLOYED) return;
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
          headers: { "content-type": "application/json", ...devTokenHeader },
          body: JSON.stringify({ workspaceId: randomUUID() }),
        });
        if (r.ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error(`tapedb dev did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  after(() => {
    for (const db of clients) db.$close();
    if (dev) try { process.kill(-dev.pid, "SIGTERM"); } catch {}
  });
}

const clients = [];

export async function claim(workspaceId, sub, role) {
  const r = await fetch(`${URL}/_tapedb/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", ...devTokenHeader },
    body: JSON.stringify({ workspaceId, sub, role: WORKSPACE_ROLE_LEVELS[role.toUpperCase()] }),
  });
  if (!r.ok) throw new Error(`claim ${r.status}: ${await r.text()}`);
  return (await r.json()).token;
}

/** A client in `workspace` as `sub` with `role` (dev claims). */
export function person(workspace, sub = "dev-user", role = "editor") {
  const db = createClient({ schema, url: URL, workspace, getToken: () => claim(workspace, sub, role) });
  db.sub = sub;
  clients.push(db);
  return db;
}

export const dataset = () => randomUUID();

/** Resolves with the error a refused write raises, or fails when it lands. */
export async function refused(write) {
  try {
    await write;
  } catch (error) {
    return error;
  }
  throw new Error("the write landed; it should have been refused");
}

export const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
