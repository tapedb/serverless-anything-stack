import { fileCheck, schema } from "@tapedb/tapedb/schema";
import { compile, field } from "./cms/content.ts";

/**
 * Content types for the CMS fixture. `compile` turns each
 * type into a document model and a draft model with server-side validation,
 * revision checks and rich-text field locks (cms/content.ts).
 */
export const contentTypes = {
  author: {
    name: field.string({ required: true, max: 80 }),
    bio: field.richText(),
  },
  post: {
    title: field.string({ required: true, max: 120 }),
    slug: field.slug({ required: true }),
    summary: field.string({ max: 280 }),
    body: field.richText({ required: true }),
    author: field.reference("author", { required: true }),
    related: field.reference("post", { weak: true }),
  },
  // The unlocked baseline for t.concurrent-edit: what happens without field locks.
  note: {
    text: field.richText({ lock: false }),
  },
};

// Files under public/ are readable by anyone with a claim (the delivery path
// reads them as a user); everything else needs a contributor.
export default schema(compile(contentTypes), {
  files: { read: fileCheck(({ auth, file }) => file.path.startsWith("public/") || auth.role >= 2) },
});
