import { model, schema, t } from "@tapedb/tapedb/schema";

/**
 * Error tracking, one TapeDB workspace per organization.
 *
 * Raw events never enter TapeDB; only issues do. An issue's count is the sum
 * of its tallies, one tally per accepted queue message, keyed by the message
 * id: a redelivered message upserts the tally it already wrote, so a retry
 * cannot count an event twice, and no counter is read-modified-written.
 */
export default schema({
  issue: model({
    fingerprint: t.string().unique(),
    title: t.string(),
    level: t.enum(["fatal", "error", "warning", "info", "debug"]).default("error").index(),
    status: t.enum(["unresolved", "resolved", "ignored"]).default("unresolved").index(),
    firstSeen: t.number(),
    lastSeen: t.number().index(),
    tallies: t.hasMany("tally"),
  }),
  tally: model({
    count: t.number(),
    issue: t.belongsTo("issue", { onDelete: "cascade" }),
  }),
  deadLetter: model({
    reason: t.string(),
    body: t.string(),
    attempts: t.number(),
  }),
});
