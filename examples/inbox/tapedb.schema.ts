import { model, role, schema, t } from "@tapedb/tapedb/schema";

/**
 * A support inbox, one TapeDB workspace per account.
 *
 * Unread is not a stored counter: it is a live count of contact messages sent
 * after the conversation's lastReadAt. A stored counter would need
 * read-modify-write across concurrent sends; a count cannot drift.
 */
export default schema({
  contact: model({
    name: t.string(),
    email: t.string().optional().index(),
    conversations: t.hasMany("conversation"),
  }),
  conversation: model({
    subject: t.string(),
    status: t.enum(["open", "pending", "resolved"]).default("open").index(),
    assigneeId: t.string().optional().index(),
    lastReadAt: t.number().default(0),
    contact: t.belongsTo("contact"),
    messages: t.hasMany("message"),
  }).access({ delete: role("admin") }),
  message: model({
    body: t.string(),
    sender: t.enum(["contact", "agent"]).index(),
    sentAt: t.number().index(),
    conversation: t.belongsTo("conversation", { onDelete: "cascade" }),
  }),
});
