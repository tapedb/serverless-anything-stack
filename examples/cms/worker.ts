import { studio } from "@tapedb/tapedb/studio";
import { defineTapeDB } from "@tapedb/tapedb/worker";

import { withDelivery } from "./cms/delivery";
import schema, { contentTypes } from "./tapedb.schema";
import { migrations } from "./tapedb/migrations.gen";

// Set at build time by wrangler's `define` (wrangler.jsonc for tapedb dev, the
// generated config for a deployment): where this Worker is reachable, and the
// secret that signs the change webhooks it sends itself.
declare const __CMS_PUBLIC_URL__: string | undefined;
declare const __CMS_HOOK_SECRET__: string | undefined;
const publicUrl = typeof __CMS_PUBLIC_URL__ === "string" ? __CMS_PUBLIC_URL__ : undefined;
const hookSecret = typeof __CMS_HOOK_SECRET__ === "string" ? __CMS_HOOK_SECRET__ : undefined;
const types = Object.keys(contentTypes);

const tapedb = defineTapeDB({
  schema,
  migrations,
  // Development and test deployments only: serves POST /_tapedb/claim so the
  // client works with no session. defineTapeDB refuses that route when
  // ENVIRONMENT is "production".
  devClaims: true,
  studio,
  // Published documents reach the delivery path through change webhooks.
  webhooks: publicUrl && hookSecret ? [{ url: `${publicUrl}/_cms/hook`, events: ["create", "update", "delete"], models: types, secret: hookSecret }] : [],
});

// Cloudflare requires the Durable Object class to be exported by the Worker
// that declares the binding.
export const WorkspaceRoom = tapedb.WorkspaceRoom;

export default withDelivery(tapedb.worker as any, hookSecret ? { hookSecret, types } : null);
