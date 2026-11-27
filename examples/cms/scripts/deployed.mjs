// Deploys the CMS fixture to a temporary Worker with your wrangler login, runs
// the whole test suite against it, and deletes the Worker afterwards.
//
//   npm run test:deployed            deploy, test, delete the Worker
//   npm run test:deployed -- --keep  leave it running (prints how to delete it)
//   npm run test:deployed -- test/image.test.mjs   only these test files
//
// The Worker is named cms-fixture-<random>, runs with ENVIRONMENT=staging and
// the development claim route, which answers only requests carrying this run's
// random token, and has its own R2 buckets. Wrangler cannot delete a bucket that
// still holds objects: empty and delete them afterwards (the names are printed).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TapeDB's header for the development claim route's token (TAPEDB_DEV_CLAIMS_TOKEN).
const DEV_TOKEN_HEADER = "x-tapedb-dev-token";
const root = new URL("..", import.meta.url).pathname;
const keep = process.argv.includes("--keep");
const name = `cms-fixture-${randomBytes(3).toString("hex")}`;
const buckets = { DATA: `${name}-data`, FILES: `${name}-files`, CONTENT: `${name}-content` };
const config = join(root, "wrangler.deployed.jsonc");
const scratch = mkdtempSync(join(tmpdir(), "cms-deploy-"));

const wrangler = (args, { capture = false } = {}) => {
  console.log(`$ wrangler ${args.join(" ")}`);
  const r = spawnSync("npx", ["--no-install", "wrangler", ...args], { cwd: root, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (r.status !== 0) throw new Error(`wrangler ${args[0]} failed${capture ? `:\n${r.stdout}\n${r.stderr}` : ""}`);
  return capture ? `${r.stdout}\n${r.stderr}` : "";
};

function writeConfig(define) {
  const base = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const cfg = {
    ...base,
    name,
    // Webhooks go from the workspace back to this Worker's own public URL.
    compatibility_flags: [...base.compatibility_flags, "global_fetch_strictly_public"],
    // The development claim route, closed with a token only this run knows.
    vars: { ENVIRONMENT: "staging", TAPEDB_DEV_CLAIMS: "true" },
    define,
    r2_buckets: Object.entries(buckets).map(([binding, bucket_name]) => ({ binding, bucket_name })),
  };
  writeFileSync(config, JSON.stringify(cfg, null, 2));
}

const deployedUrl = (output) => output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];

let url;
let ok = false;
try {
  wrangler(["whoami"]);
  // First deploy to learn the URL; the second bakes the URL and the webhook secret in.
  writeConfig({});
  for (const bucket of Object.values(buckets)) {
    // --update-config=false: wrangler would otherwise add the bucket to a config file.
    wrangler(["r2", "bucket", "create", bucket, "-c", config, "--update-config=false"], { capture: true });
  }
  url = deployedUrl(wrangler(["deploy", "-c", config], { capture: true }));
  if (!url) throw new Error("could not read the workers.dev URL from wrangler deploy");
  const hookSecret = randomBytes(32).toString("base64url");
  const devToken = randomBytes(32).toString("base64url");

  // Secrets before the final deploy, so the version that serves the tests has
  // them from its first request. (Set after it, a new version rolls out with the
  // secrets while requests can still reach the old one: a test once hit
  // "TAPEDB_CLAIM_SECRET is not configured" that way.)
  const secretsFile = join(scratch, "secrets.json");
  writeFileSync(secretsFile, JSON.stringify({
    TAPEDB_CLAIM_SECRET: randomBytes(32).toString("base64"),
    TAPEDB_KEY_SECRET: randomBytes(32).toString("base64"),
    TAPEDB_DEV_CLAIMS_TOKEN: devToken,
  }), { mode: 0o600 });
  wrangler(["secret", "bulk", secretsFile, "-c", config]);
  rmSync(secretsFile);
  writeConfig({ __CMS_PUBLIC_URL__: JSON.stringify(url), __CMS_HOOK_SECRET__: JSON.stringify(hookSecret) });
  wrangler(["deploy", "-c", config]);

  // Ready when the final version answers: 5 claim + authenticated engine reads
  // in a row succeed, and the hook route exists (it does only with the define).
  // A new workers.dev name can take a minute to answer.
  const deadline = Date.now() + 180_000;
  for (let streak = 0; streak < 5; ) {
    let ok = false;
    try {
      const workspaceId = crypto.randomUUID();
      const claim = await fetch(`${url}/_tapedb/claim`, { method: "POST", headers: { "content-type": "application/json", [DEV_TOKEN_HEADER]: devToken }, body: JSON.stringify({ workspaceId }) });
      if (claim.ok) {
        const { token } = await claim.json();
        const schema = await fetch(`${url}/engine/workspaces/${workspaceId}/schema`, { headers: { authorization: `Bearer ${token}` } });
        const hook = await fetch(`${url}/_cms/hook`, { method: "POST", body: "{}" });
        ok = schema.ok && hook.status === 401;
      }
    } catch {}
    streak = ok ? streak + 1 : 0;
    if (Date.now() > deadline) throw new Error(`${url} was not ready within 3 minutes`);
    if (streak < 5) await new Promise((r) => setTimeout(r, ok ? 500 : 3000));
  }
  console.log(`\n${url} is up; running the suite against it\n`);

  const only = process.argv.slice(2).filter((a) => a.endsWith(".test.mjs"));
  const run = spawnSync("node", ["--test", "--test-concurrency=1", ...(only.length ? only : readTests())], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CMS_URL: url, CMS_HOOK_SECRET: hookSecret, CMS_DEV_TOKEN: devToken },
  });
  ok = run.status === 0;
} finally {
  if (!keep && url) {
    try { wrangler(["delete", "--name", name, "--force"]); } catch (e) { console.error(String(e)); }
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(config, { force: true });
  console.log(`\nWorker ${name}: ${keep && url ? `kept at ${url} (delete: npx wrangler delete --name ${name} --force)` : "deleted"}`);
  console.log(`Buckets to empty and delete: ${Object.values(buckets).join(", ")}`);
}
process.exit(ok ? 0 : 1);

function readTests() {
  return execFileSync("ls", ["test"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`);
}
