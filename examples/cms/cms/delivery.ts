/**
 * The delivery path: anonymous, cached reads of published content and images,
 * served by the CMS Worker without going through the workspace for each read.
 *
 *   POST /_cms/hook                      TapeDB change webhooks (signed). A published
 *                                        document is written to the CONTENT bucket; an
 *                                        unpublished or deleted one is removed. Writes are
 *                                        ordered by `rev`, so a late or repeated delivery
 *                                        never replaces a newer revision.
 *   GET  /content/:ws/:type/:id          the published document, as JSON
 *   GET  /content/:ws/:type?slug=:slug   the same, by slug
 *   GET  /img/:ws/:path?w&h&fx&fy&f      an image file from the workspace, resized and
 *                                        cropped around the focal point (fx, fy in 0-1),
 *                                        by the Images binding
 *
 * Responses are kept in the Workers Cache API for MAX_AGE seconds and carry
 * `x-cms-cache: hit|miss`. A webhook purges the cached response in the colo it
 * lands in; other colos serve theirs until MAX_AGE runs out.
 */
import { signRoleClaim } from "@tapedb/tapedb/worker";
import { verifySignature } from "./signature";

const MAX_AGE = 10;
const USER = 1;

export interface DeliveryOptions {
  /** HMAC secret of the webhook (the same string given to defineTapeDB's webhooks). */
  hookSecret: string;
  /** Document models whose published rows are delivered. */
  types: string[];
}

type Env = Record<string, any>;
type Handler = { fetch: (request: Request, env: Env, ctx: any) => Promise<Response> | Response };

const docKey = (ws: string, type: string, id: string) => `content/${ws}/${type}/${id}.json`;
const slugKey = (ws: string, type: string, slug: string) => `content/${ws}/${type}/slug/${encodeURIComponent(slug)}`;

const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

async function purge(origin: string, paths: string[]) {
  const cache = (globalThis as any).caches?.default;
  if (!cache) return;
  await Promise.all(paths.map((p) => cache.delete(new Request(origin + p))));
}

async function handleHook(request: Request, env: Env, options: DeliveryOptions) {
  const body = await request.text();
  if (!(await verifySignature(options.hookSecret, request.headers.get("x-tapedb-signature"), body))) {
    return json(401, { error: "bad_signature" });
  }
  const event = JSON.parse(body) as { workspaceId: string; model: string; op: string; row: Record<string, any> | null };
  if (!options.types.includes(event.model) || !event.row) return json(200, { ignored: true });
  const { workspaceId: ws, model: type, row } = event;
  const key = docKey(ws, type, row.id);
  const stored = await env.CONTENT.head(key);
  const storedRev = stored ? Number(stored.customMetadata?.rev ?? 0) : 0;
  const origin = new URL(request.url).origin;
  const paths = [`/content/${ws}/${type}/${row.id}`];
  const oldSlug = stored?.customMetadata?.slug;
  if (oldSlug) paths.push(`/content/${ws}/${type}?slug=${encodeURIComponent(oldSlug)}`);

  if (event.op === "delete") {
    await env.CONTENT.delete([key, ...(oldSlug ? [slugKey(ws, type, oldSlug)] : [])]);
    await purge(origin, paths);
    return json(200, { removed: true });
  }
  // A late or repeated delivery of an older revision changes nothing.
  if (typeof row.rev !== "number" || row.rev <= storedRev) return json(200, { stale: true, storedRev });

  if (row.publishedAt == null) {
    // Unpublished: keep a tombstone with the rev so an older publish arriving late cannot bring it back.
    await env.CONTENT.put(key, "null", { customMetadata: { rev: String(row.rev), slug: "" } });
    if (oldSlug) await env.CONTENT.delete(slugKey(ws, type, oldSlug));
  } else {
    const slug = typeof row.slug === "string" ? row.slug : "";
    await env.CONTENT.put(key, JSON.stringify(row), { httpMetadata: { contentType: "application/json" }, customMetadata: { rev: String(row.rev), slug } });
    if (oldSlug && oldSlug !== slug) await env.CONTENT.delete(slugKey(ws, type, oldSlug));
    if (slug) {
      await env.CONTENT.put(slugKey(ws, type, slug), row.id);
      paths.push(`/content/${ws}/${type}?slug=${encodeURIComponent(slug)}`);
    }
  }
  await purge(origin, paths);
  return json(200, { stored: row.rev });
}

async function cached(request: Request, ctx: any, produce: () => Promise<Response>) {
  const cache = (globalThis as any).caches?.default;
  const hit = cache ? await cache.match(request) : undefined;
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("x-cms-cache", "hit");
    return response;
  }
  const produced = await produce();
  if (produced.status !== 200) return produced;
  // Copy: a response from a binding (Images) has immutable headers.
  const fresh = new Response(produced.body, produced);
  fresh.headers.set("cache-control", `public, max-age=${MAX_AGE}`);
  if (cache) ctx.waitUntil(cache.put(request, fresh.clone()));
  fresh.headers.set("x-cms-cache", "miss");
  return fresh;
}

async function handleContent(request: Request, env: Env, ctx: any, options: DeliveryOptions, parts: string[]) {
  const [ws, type, id] = parts;
  if (!ws || !type || !options.types.includes(type)) return json(404, { error: "not_found" });
  return cached(request, ctx, async () => {
    let docId = id;
    if (!docId) {
      const slug = new URL(request.url).searchParams.get("slug");
      if (!slug) return json(400, { error: "id_or_slug" });
      const pointer = await env.CONTENT.get(slugKey(ws, type, slug));
      if (!pointer) return json(404, { error: "not_found" });
      docId = await pointer.text();
    }
    const object = await env.CONTENT.get(docKey(ws, type, docId));
    if (!object) return json(404, { error: "not_found" });
    const text = await object.text();
    if (text === "null") return json(404, { error: "not_found" });
    return new Response(text, { headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

async function handleImage(request: Request, env: Env, ctx: any, tapedb: Handler, parts: string[]) {
  if (!env.IMAGES) return json(501, { error: "images_binding_missing" });
  const [ws, ...rest] = parts;
  const path = rest.join("/");
  if (!ws || !path) return json(404, { error: "not_found" });
  const q = new URL(request.url).searchParams;
  const width = Number(q.get("w") ?? 0) || undefined;
  const height = Number(q.get("h") ?? 0) || undefined;
  const fx = q.get("fx");
  const fy = q.get("fy");
  const format = q.get("f") === "png" ? "image/png" : q.get("f") === "jpeg" ? "image/jpeg" : "image/webp";
  return cached(request, ctx, async () => {
    // Read the original through TapeDB's file route as a reader: file rules decide what is public.
    const { token } = await signRoleClaim(env.TAPEDB_CLAIM_SECRET, { sub: "cms-delivery", workspaceId: ws, role: USER, ttlSeconds: 60 });
    const origin = new URL(request.url).origin;
    const original = await tapedb.fetch(
      new Request(`${origin}/engine/workspaces/${ws}/files/${path}`, { headers: { authorization: `Bearer ${token}` } }),
      env,
      ctx,
    );
    if (!original.ok || !original.body) return json(original.status === 403 ? 404 : original.status, { error: "not_found" });
    const transform: Record<string, unknown> = { fit: "cover" };
    if (width) transform.width = width;
    if (height) transform.height = height;
    if (fx !== null && fy !== null) transform.gravity = { x: Number(fx), y: Number(fy) };
    try {
      const result = await env.IMAGES.input(original.body).transform(transform).output({ format });
      return result.response();
    } catch (error) {
      return json(502, { error: "transform_failed", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** Wraps the TapeDB Worker with the delivery routes. */
export function withDelivery(tapedb: Handler, options: DeliveryOptions | null): Handler {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (options && url.pathname === "/_cms/hook" && request.method === "POST") return handleHook(request, env, options);
      if (options && parts[0] === "content" && request.method === "GET") return handleContent(request, env, ctx, options, parts.slice(1));
      if (parts[0] === "img" && request.method === "GET") return handleImage(request, env, ctx, tapedb, parts.slice(1));
      return tapedb.fetch(request, env, ctx);
    },
  };
}
