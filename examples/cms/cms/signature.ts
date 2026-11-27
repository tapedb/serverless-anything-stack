/**
 * TapeDB webhook signatures: `X-Tapedb-Signature: t=<seconds>,v1=<hex>`, the
 * HMAC-SHA256 of `<t>.<body>` under the webhook's secret. Kept apart from
 * delivery.ts so tests can sign deliveries without loading the Worker runtime.
 */
const SIGNATURE_TOLERANCE_S = 300;

const encoder = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

/** True when `header` (t=<seconds>,v1=<hex>) signs `body` with `secret` and is recent. */
export async function verifySignature(secret: string, header: string | null, body: string, now = Date.now()) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = await hmac(secret, `${t}.${body}`);
  if (typeof parts.v1 !== "string" || parts.v1.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(secret: string, body: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
}
