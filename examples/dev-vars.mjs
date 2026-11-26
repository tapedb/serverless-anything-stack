// Writes .dev.vars with fresh local secrets if the fixture has none. Local only.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const names = process.argv.slice(2);
if (!existsSync(".dev.vars")) {
  writeFileSync(".dev.vars", names.map((n) => `${n}=${randomBytes(32).toString("base64")}`).join("\n") + "\n", { mode: 0o600 });
  console.log("wrote .dev.vars with fresh local secrets");
}
