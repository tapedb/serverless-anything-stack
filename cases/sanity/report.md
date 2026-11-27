# Sanity (Studio and Content Lake): assessment

Generated from `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.

- **Upstream:** https://github.com/sanity-io/sanity at `4456246c8a43cb2bb13b42fa7ab5b67859ae42c7` (inspected 2026-11-27)
- **License:** MIT (Studio); Content Lake is a hosted service, not in the repository
- **Approach:** compatible-rewrite
- **Capabilities:** 2 verified, 15 partial, 7 unverified, 1 not-applicable

## Architecture

A compatible rewrite: a CMS layer on TapeDB, not a port of Content Lake. One TapeDB workspace per dataset holds documents, versions, releases, revisions and asset records with role and row rules; the Studio uses live queries, presence and the client outbox; assets are TapeDB files on R2 with transforms by the Images binding; published content is written to R2 and served behind the Workers Cache API by a delivery Worker refreshed from TapeDB webhooks; schedules run on Workflows. Everything deploys into the customer's own Cloudflare account.

| component | primitive | responsibility |
| --- | --- | --- |
| Content workspace | TapeDB workspace | documents, drafts, versions, releases, revisions, asset records, schedules, members |
| Studio | React app on the CMS Worker; TapeDB live queries, presence, client outbox | editing, publishing, releases, history |
| Assets | TapeDB files on R2 | uploads and file rules |
| Image transforms | Cloudflare Images binding + Workers Cache API | resized and cropped images for front ends |
| Delivery | Worker + R2 + Workers Cache API, refreshed by TapeDB webhooks | anonymous, cached reads of published content |
| Scheduler | Workflows | publishing documents and releases at a set time |
| Auth | TapeDB built-in auth (Better Auth) | editor sign-in, sessions, workspace roles |
| Search | TapeDB vector-search on Vectorize (optional) | Studio and site search over one search-document model |

## Capability matrix

| capability | status | decision | candidate | gaps | tests |
| --- | --- | --- | --- | --- | --- |
| Datasets are isolated content environments | verified | reuse | One TapeDB workspace per dataset; claims are scoped to one workspace |  | t.fixture-isolation (pass, workerd-local) |
| Several document changes commit together | verified | reuse | TapeDB $transaction in one workspace; optimistic locking by a rev column that every write must advance by one, enforced by a check() rule inside the transaction |  | t.select (pass, deployed), t.fixture-publish (pass, workerd-local) |
| Content types defined in code and compiled into storage | partial | extend | A content-type language compiled to TapeDB models, a document and a draft model per type (examples/cms/cms/content.ts); migrations from tapedb migrate dev | Content Lake stores any JSON and has no migrations; here an added field is a generated migration file (no data-loss flag) to commit, and a removed field needs --accept-data-loss. The CMS still has to run migrate dev for the user. The fixture covers string, slug, number, rich text and references; arrays of objects, images, files and localized fields are not compiled yet. Arrays of objects with stable _key and deep nesting (20 levels in Sanity) have no direct column type: child models or t.json() decide what can be filtered. | t.fixture-content-model (pass, workerd-local) |
| Validation of content rules | partial | extend | check() write rules compiled from the content types: drafts may be incomplete but keep field constraints; a published document must be complete and valid | Sanity validates only in the Studio; here validation also runs on API writes, so an import can be refused where Sanity accepted the data (the importer must report it). A check() rule sees only the row being written: rules that need other documents (a referenced document is published, a slug unique across drafts) cannot be checked there. | t.fixture-content-model (pass, workerd-local) |
| References between documents with integrity | partial | extend | belongsTo with onDelete restrict for strong references (to the target's document row); a plain indexed id column for weak ones | A strong reference points at the target's document row, which exists from the first draft: a document can be published while its referenced target is unpublished. Sanity refuses that; here it needs a check outside check() (it cannot read the target). References into release versions need rules of the CMS's own. Cross-dataset references are not supported: a relation stays in one workspace. | t.relation-live (pass, deployed), t.fixture-content-model (pass, workerd-local) |
| Concurrent edits to one document merge at field and text level | partial | extend | Whole-attribute writes; per-field locks on rich-text fields, enforced by check() rules (taken only when free, at most 30 s, released by the holder, taken over once expired); a CRDT (Yjs over broadcast) for rich text later | Measured: without a lock, two edits to one rich-text body from the same base lose one of them (last write wins on the attribute). Sanity applies path patches and diff-match-patch and rebases local changes, so both survive. With locks no edit is lost, but editors take turns on a field; real co-editing of one field needs a CRDT or a sub-path patch operation (none on t.json() in TapeDB 0.4.2). Lock expiry uses the Durable Object's clock against the client's requested term; a client clock far off can only shorten its own lock. | t.concurrent-edit (pass, workerd-local) |
| Editors and previews see changes as they happen | partial | reuse | TapeDB live queries over one socket per workspace | Sanity listeners emit mutation events (patches, transaction ids); live queries emit result diffs, so a Studio built on them diffs documents, not mutations. Each write re-runs the live queries on the models it touches; autosave on every keystroke must be batched (about 18 ms per write at 100 live queries). | t.live-order (pass, deployed), t.relation-live (pass, deployed), t.autosave-load (not-run) |
| Who is looking at which document and field | partial | reuse | TapeDB presence rooms, field location in the presence payload | At most 4 presence rooms per socket by default; fan-out grows with the square of the room (60 ms p50 at 200 peers). | t.presence (pass, deployed) |
| A draft and a published version per document; publish, unpublish, discard, restore | partial | extend | A document model (published values, rev, publishedAt) and a draft model sharing its id; publish writes the document and deletes the draft in one transaction; readers see published rows only (filter rule), drafts are for editors | Publish, unpublish, restore of an earlier revision and the refusal of a stale or invalid publish are tested; discarding a draft (deleting the draft row) is not. Sanity's ID prefixes (drafts., versions.) become separate models; a query names the model, not a perspective. | t.fixture-publish (pass, workerd-local) |
| Group versions of many documents and publish them as a unit | partial | extend | A cmsRelease model and a <type>Version model per type; publishing a release applies every version, writes their revisions, deletes the versions and marks the release published in one transaction | A release that spans datasets cannot be atomic: one workspace per transaction. Measured locally only: 1,000 versions (3,001 writes) published whole in about 0.5 s under tapedb dev; not measured deployed, and no upper bound found (Sanity caps a release at 1,000 versions and 100 MB). Scheduling a release (t.schedule), previewing a release as a perspective, and copying versions between releases are not built. | t.fixture-release (pass, workerd-local) |
| Document revisions, restore, and who made each change | partial | extend | An immutable <type>Revision row written in the same transaction as each publish and unpublish (values, rev, writer checked against the claim); restore copies a revision into the draft | Revisions are per publish, not per edit: Sanity also keeps every draft change; edit history of drafts is not recorded. A check() rule cannot see other rows, so nothing in the engine forces a publish to carry its revision row: the CMS's publish route must (ops.ts does). Sanity truncates history by plan (3/90/365 days); here revisions stay until an admin deletes them, and revisions holding personal data need personal fields to stay erasable. | t.revisions (pass, workerd-local) |
| Upload, store and reference images and files | partial | extend | TapeDB files on R2 with file rules; an asset record per file with metadata, crop and hotspot | Sanity's assets are public on its CDN even in private datasets; file rules here decide reads, so public delivery needs an explicit public rule or the delivery Worker. Content-hash dedupe of uploads and image metadata extraction (dimensions, palette, blurhash) are application code. | t.file-rules (pass, deployed), t.image-transform (not-run) |
| Front ends query published content | partial | extend | A typed delivery SDK over TapeDB reads (findMany, include, aggregates), and named read-only SQL for one-off reads | No GROQ. Queries written for Sanity must be rewritten; projections become select/include. Every engine route needs a verified claim: anonymous front-end reads go through the delivery Worker, not the workspace. | t.select (pass, deployed), t.delivery-snapshot (not-run) |
| Notify other systems when content changes | partial | reuse | TapeDB signed change webhooks, filtered and shaped by the CMS before forwarding | No GROQ filters or projections; filtering is configuration of the CMS (type, perspective, fields). Before/after values: what the TapeDB event body carries was not checked here. | t.webhooks (pass, workerd-local) |
| Members and roles decide who can read, edit and publish | partial | extend | TapeDB role levels in compiled rules: users read published documents; members write drafts and release versions; editors publish; admins delete | Four fixed levels; Sanity's custom roles and document-level grant filters (per type or per field) are not mapped. Under tapedb dev the role comes from the development claim; a deployment needs an identity adapter or built-in auth to assign it. | t.roles (pass, workerd-local) |
| Editors sign in | partial | reuse | TapeDB built-in auth (Better Auth) with the Studio on the same Worker | Sanity accounts and SSO are hosted by Sanity; SAML is out of TapeDB's scope. | t.sessions (pass, workerd-local) |
| Export a dataset and import it elsewhere, including from Sanity | partial | extend | TapeDB NDJSON export/import between workspaces; a Sanity importer that reads a datasets export tarball, maps documents to models and uploads assets to R2 | TapeDB import copies file metadata, not file bytes; assets are copied separately. The Sanity importer does not exist: Portable Text, references, drafts and versions must be mapped, and documents that fail server validation reported. | t.sanity-import (not-run) |
| Publish a document or release at a set time | unverified | external | Workflows (sleepUntil the publish time, then call the publish route) or a Cron Trigger scanning due schedules | TapeDB provides no timers; the schedule is a row in the workspace and the timer lives in Workflows or a Cron Trigger. A schedule changed after its workflow started must be detected at fire time (compare the schedule row's revision). | t.schedule (not-run) |
| Resize, crop, format and hotspot-aware image URLs | unverified | external | Cloudflare Images binding on R2 originals inside the delivery Worker, results stored with the Workers Cache API; a URL builder that applies crop and hotspot | Parameter names differ from Sanity's image URLs; a compatibility layer for @sanity/image-url URLs is optional. Billed per unique transformation beyond 5,000 a month. | t.image-transform (not-run) |
| Cached, high-volume reads of published content | unverified | extend | On publish, the delivery Worker writes published documents to R2 and serves them behind the Workers Cache API; TapeDB webhooks trigger the refresh | Webhooks deliver after the log reaches R2 (up to the 30 s durability alarm delay plus the flush): publish-to-live latency is bounded by that, not measured. At-least-once webhooks: the refresh must be idempotent (write by document id and published revision). | t.delivery-snapshot (not-run) |
| Find documents by text in the Studio and on sites | unverified | extend | TapeDB vector, text and hybrid search on one search-document model fed on save and publish | One indexed model per deployment: all content types share one search model. The keyword half needs an embed provider; Vectorize visibility lags the write; no live search subscriptions. | t.search (not-run) |
| An editing Studio generated from content types, extensible with plugins | unverified | extend | A new React Studio served from the user's Worker: generated forms, document lists, TipTap (ProseMirror) rich text, reference picker, image crop and hotspot, draft/publish bar, plugin API | Not built; the largest part of the product. Adapting Sanity Studio itself (MIT) is not the proposed route: it is built around @sanity/client, Content Lake listeners and mutations (d.studio). Rich text stored as ProseMirror JSON, not Portable Text: imports convert, and Sanity front-end renderers do not apply. | t.studio-smoke (not-run) |
| Comments on fields and editorial tasks | unverified | exclude | TapeDB models in the content workspace with live queries | Deferred past v1. |  |
| Edit content in place on the live front end | unverified | exclude | Preview mode in the framework integrations; overlays later | Deferred past v1; v1 has preview of drafts only. |  |
| Canvas, Media Library, content variants and agent features | not-applicable | exclude | None | Hosted Sanity services outside this assessment. |  |

## Tests

| test | runtime | result | ran | command |
| --- | --- | --- | --- | --- |
| Typed reads and writes in workerd and on staging | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only select (tapedb)` |
| Live diffs keep order when rows move | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only live-order (tapedb)` |
| Live queries over relations update | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only relation-live (tapedb)` |
| Presence rooms, refusals and peer lists | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only presence (tapedb)` |
| File rules decide reads and writes | deployed | pass | 2026-11-26 | `node scripts/e2e.mjs --only file-rules (tapedb)` |
| Signed webhooks delivered in order with retries | workerd-local | pass | 2026-11-26 | `node scripts/e2e.mjs --only webhooks (tapedb)` |
| Revoke one session and the others | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| A claim for one workspace presented to another's is refused (403 wrong_workspace) | workerd-local | pass | 2026-11-26 | `cd examples/inbox && npm test` |
| Content types compile to document and draft models; server-side validation refuses an incomplete or invalid publish, also sent straight at the model; published slugs unique; a strong reference refuses the target's deletion, a weak one may dangle; an added field generates a migration with no data-loss flag, a removal needs one | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |
| Readers see nothing until publish, then the whole document, live as one change; of two publishes from one revision exactly one lands; a publish on an older revision is refused and leaves draft and document as they were; an invalid publish rolls back whole; unpublish | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |
| A release publishes new and existing documents across types at once (a live reader never sees half); one document changed after the release was read, or one invalid version, refuses the whole release; of two concurrent publishes one lands and the release cannot be reopened; 1,000 versions publish whole (about 0.5 s locally) | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |
| Different fields written at once both land; without a lock one of two body edits is lost; with locks the second editor is refused until release and no edit is lost; four editors race for one lock and one gets it; an expired lock is taken over; a lock longer than 30 s is refused | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |
| Each publish and unpublish leaves a revision with values, rev and writer; a refused publish leaves none; revisions cannot be edited or written in another's name; restoring an earlier revision and publishing it makes a new revision | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |
| A reader sees published documents only and cannot write; a contributor writes drafts but cannot publish, also not straight at the model; an editor publishes but cannot delete; an admin deletes, cascading to revisions; a contributor cannot write revisions or publish a release | workerd-local | pass | 2026-11-27 | `cd examples/cms && npm test` |

Not run yet (the backlog):

- `t.autosave-load` (deployed): 20 editors autosaving once a second with 100 live queries: write latency p50/p99
- `t.schedule` (deployed): A scheduled release publishes at its time; a schedule changed after start does not fire the old version
- `t.delivery-snapshot` (deployed): Publish to cached read on the delivery Worker; measure publish-to-live latency; a redelivered webhook writes the same snapshot
- `t.image-transform` (deployed): Resize and crop with hotspot through the Images binding from R2, cached
- `t.search` (deployed): Text search over the search-document model after save
- `t.sanity-import` (workerd-local): Import a Sanity datasets export tarball: documents, Portable Text, references, assets; report rejects
- `t.studio-smoke` (manual): Studio: create, edit, publish, upload an image, view history in a browser

## Risks

- **Two editors in one rich-text body overwrite each other: TapeDB writes whole attributes.** Presence-based field locks in v1; measure with t.concurrent-edit; then a CRDT over broadcast or a json sub-path patch in TapeDB.
- **All editors and autosaves of a dataset go through one writer; latency rises past about 4 concurrent writers.** Batch autosave; measure with t.autosave-load; split large organisations into several datasets.
- **The Studio is the product and the largest piece of work; a thin Studio loses against Sanity's.** v1 scope fixed (content types, drafts and publishing, Studio, assets, delivery, SDK); plugin API from the start.
- **Published content reaches the delivery path only after webhooks, which wait for the R2 flush (up to about 30 s).** Measure in t.delivery-snapshot; if too slow, have the publish route write the snapshot directly after commit and keep the webhook as the repair path.
- **One indexed model per deployment limits search to one shared model.** A search-document model fed on save and publish; search marked optional.
- **Sanity datasets may hold documents that break this CMS's server-side validation or use Portable Text features without a ProseMirror equivalent.** The importer reports per document and keeps unconvertible blocks as raw JSON for manual review.

## Decisions

### Compile content types into TapeDB models (accepted)

Content Lake is schemaless JSON with schemas in Studio config; TapeDB is relational with reviewed migrations.

- **Compile content types into TapeDB models** (chosen): Types, foreign keys, filters and row rules per field; every model change is a migration the CMS must generate.
- One generic documents model with a t.json() body: Schemaless like Sanity, no migrations; no filtering or rules on fields inside the body, no foreign keys.

The CMS generates migrations for additive changes and asks for review of destructive ones (t.fixture-content-model, passing).

### Build a new Studio rather than adapt Sanity Studio (proposed)

Sanity Studio is MIT, but its document store, history, presence and search are written against Content Lake through @sanity/client and the mutator.

- Adapt Sanity Studio to a TapeDB backend: Mature UI for free; an adapter would have to emulate Content Lake's listeners, mutations, GROQ and history, which TapeDB does not provide.
- **A new Studio on TapeDB's client** (chosen): Large build; designed around live queries, presence and the outbox instead of emulating Content Lake.

No Sanity code copied unless attributed under MIT; Sanity's form and structure concepts inform the design.

### Rich text editor (accepted)

Sanity stores rich text as Portable Text, edited with @portabletext/editor.

- **TipTap (ProseMirror)** (chosen): Mature, structured JSON documents, Yjs collaboration support; not Portable Text, so imports convert.
- @portabletext/editor: Sanity-compatible data; its license and coupling to Sanity packages were not checked.
- Lexical: Fast, Meta-maintained; its own JSON format, collaboration through Yjs as well.

The Sanity importer converts Portable Text to ProseMirror JSON; the SDK ships renderers.

### Concurrent editing in v1 (proposed)

Sanity merges concurrent edits with path patches and rebasing; TapeDB writes whole attributes.

- **Presence-based field locks** (chosen): Simple, uses TapeDB presence; editors wait for each other on one field.
- CRDT (Yjs) over TapeDB broadcast, persisted on save: Real co-editing in rich text; more code and a second representation of the document while editing.
- A json sub-path patch operation in TapeDB: Closest to Sanity's model; a TapeDB core change with its own review.

v1 prevents silent overwrites (t.concurrent-edit, passing); co-editing of one field is the next step.

### Serve published content from R2 and the Workers Cache API (proposed)

A workspace has one writer and every engine route needs a claim; front ends need anonymous, cached reads.

- Front ends read the workspace directly: Always current; every reader is a Durable Object request and needs a claim.
- **Published snapshot in R2 behind the Workers Cache API** (chosen): Scales with readers and costs little; publish-to-live latency bounded by webhook delivery.
- Published snapshot in Workers KV: Fast reads; eventually consistent writes and a second store; KV is not required here.

The delivery Worker owns the snapshot format and its idempotent refresh.

### Workflows for scheduled publishing (proposed)

TapeDB has no timers; Sanity uses its hosted Scheduling API.

- **A Workflow per schedule (sleep until, then publish)** (chosen): Exact times, durable steps; a changed schedule must be checked at fire time.
- A Cron Trigger every minute scanning due schedules: One mechanism, minute granularity; scans every workspace with schedules.

The schedule row carries a revision; the workflow publishes only if it still matches.

## Cost drivers

- **Workspace requests and rows:** Editing traffic only (saves, live re-runs, presence); reads by readers go to the delivery path. Not modelled yet. (cf.do-pricing)
- **Image transformations:** First 5,000 unique transformations a month included, then $0.50 per 1,000; a site with 2,000 images in 4 sizes is about 8,000 unique transformations, about $1.50 a month. (cf.images-pricing)
- **R2 storage and operations for assets and published snapshots:** Not priced in this assessment. (UNPRICED)
- **Workers requests for delivery and Studio:** Not priced in this assessment. (UNPRICED)

## Workload assumptions

- One TapeDB workspace per dataset (site or environment); a CMS deployment holds several.
- Editorial teams are small next to readers: tens of concurrent editors per workspace, millions of reads served from the delivery path, not the workspace.
- Autosave writes are batched per document (on idle, about once a second at most), not per keystroke.
- Documents stay well under Durable Object row limits (8 MB per value); large bodies are split into child rows.

## Upstream dependencies

- Sanity Content Lake: hosted document store, query engine, listeners, history, assets CDN, webhooks
- @sanity/client: HTTP and listener client used by the Studio
- @portabletext/editor: rich text editing in the Studio
- Sanity Scheduling API: scheduled publishing (optional)
