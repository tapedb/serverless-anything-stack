// t.image-transform: images stored as workspace files are resized and cropped
// around a focal point by the Images binding, cached, and only public/ files
// are served. Needs the IMAGES binding: with CMS_URL (a deployment), or under
// tapedb dev when wrangler provides it locally; skipped otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { DEPLOYED, dataset, person, startDev, URL } from "./harness.mjs";

startDev();

/** A w×h RGB PNG: left half red, right half blue. */
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      if (x < w / 2) raw[o] = 255; else raw[o + 2] = 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/** The RGB of pixel (x, y) of an 8-bit RGB or RGBA PNG. */
function pixel(buf, x, y) {
  const { width, height } = pngSize(buf);
  const channels = buf[25] === 6 ? 4 : 3;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let r = 0; r < height; r++) {
    const f = raw[r * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[r * (stride + 1) + 1 + i];
      const a = i >= channels ? out[r * stride + i - channels] : 0;
      const b = r > 0 ? out[(r - 1) * stride + i] : 0;
      const c = r > 0 && i >= channels ? out[(r - 1) * stride + i - channels] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[r * stride + i] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 0xff;
    }
  }
  const o = y * stride + x * channels;
  return [out[o], out[o + 1], out[o + 2]];
}
const blueish = ([r, , b]) => b > 200 && r < 60;
const reddish = ([r, , b]) => r > 200 && b < 60;

test("an image is resized and cropped around its focal point, cached, and only public files are served", async (t) => {
  const ws = dataset();
  const ed = person(ws, "ed", "editor");
  await ed.$files.upload(new Blob([png(400, 200)], { type: "image/png" }), { path: "public/hero.png" });
  await ed.$files.upload(new Blob([png(40, 20)], { type: "image/png" }), { path: "private/draft.png" });

  const probe = await fetch(`${URL}/img/${ws}/public/hero.png?w=100&h=100&f=png`);
  if (probe.status === 501) return t.skip("no IMAGES binding in this runtime");
  assert.equal(probe.status, 200, await probe.clone().text());
  assert.equal(probe.headers.get("content-type"), "image/png");
  assert.deepEqual(pngSize(Buffer.from(await probe.arrayBuffer())), { width: 100, height: 100 });

  // Focal point on the right (blue) half: the square crop keeps blue in its centre.
  const right = await fetch(`${URL}/img/${ws}/public/hero.png?w=50&h=50&fx=0.9&fy=0.5&f=png`);
  assert.equal(right.status, 200);
  const rightBuf = Buffer.from(await right.arrayBuffer());
  assert.deepEqual(pngSize(rightBuf), { width: 50, height: 50 });
  const left = Buffer.from(await (await fetch(`${URL}/img/${ws}/public/hero.png?w=50&h=50&fx=0.1&fy=0.5&f=png`)).arrayBuffer());
  const centres = { right: pixel(rightBuf, 25, 25), left: pixel(left, 25, 25) };
  if (DEPLOYED) {
    assert.ok(blueish(centres.right), `focal point right: centre should be blue, got ${centres.right}`);
    assert.ok(reddish(centres.left), `focal point left: centre should be red, got ${centres.left}`);
  } else {
    // wrangler's local Images binding is a low-fidelity stand-in: report what it did, assert only deployed.
    console.log(`local Images binding, crop centres: ${JSON.stringify(centres)}`);
  }

  // WebP by default; the second request for a URL is a cache hit.
  const webp = await fetch(`${URL}/img/${ws}/public/hero.png?w=120`);
  assert.equal(webp.headers.get("content-type"), "image/webp");
  assert.equal(webp.headers.get("x-cms-cache"), "miss");
  await webp.arrayBuffer();
  await new Promise((r) => setTimeout(r, 500));
  const hit = await fetch(`${URL}/img/${ws}/public/hero.png?w=120`);
  assert.equal(hit.headers.get("x-cms-cache"), "hit");

  // Files outside public/ are not served by the delivery path.
  assert.equal((await fetch(`${URL}/img/${ws}/private/draft.png?w=10`)).status, 404);
});
