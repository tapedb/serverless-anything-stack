import { studio } from "@tapedb/tapedb/studio";
import { defineTapeDB } from "@tapedb/tapedb/worker";

import schema from "./tapedb.schema";
import { migrations } from "./tapedb/migrations.gen";

const tapedb = defineTapeDB({
  schema,
  migrations,
  // Development only: serves POST /_tapedb/claim so the client works with no
  // session. defineTapeDB refuses that route when ENVIRONMENT is "production".
  devClaims: true,
  // The studio at /_tapedb/studio on the deployed Worker. It signs in through
  // /_tapedb/claim like the app, so your identity adapter decides the role.
  // Remove it to serve nothing there.
  studio,
});

// Cloudflare requires the Durable Object class to be exported by the Worker
// that declares the binding.
export const WorkspaceRoom = tapedb.WorkspaceRoom;

export default tapedb.worker;
