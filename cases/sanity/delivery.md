# Sanity (Studio and Content Lake): delivery

Generated from `project.json` and `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.

- **Goal:** A CMS built on TapeDB, released as a product next to it, that runs entirely in the customer's own Cloudflare account (data in their Durable Objects and R2). Done means a team can model content in code, edit and publish it together in a Studio, and serve it to front ends, with no server to run.
- **Repository:** https://github.com/tapedb/cms
- **Approval:** approved by Brandon Diaz on 2026-11-27. Build it as its own product (tapedb/cms, private), with no mention of Sanity in the product. Deploys only as temporary test Workers from Brandon's terminal.
- **Release gate:** 6 of 7 must requirements done; not in production

## Requirements (MoSCoW)

| id | priority | requirement | use cases | capabilities | done |
| --- | --- | --- | --- | --- | --- |
| R1 | must | Content types defined in code, validated on every write | UC-1 | content-model (partial), server-validation (partial), references (partial) | yes |
| R2 | must | Drafts and atomic publish and unpublish | UC-2 | drafts-published (partial), transactions (verified) | yes |
| R3 | must | Members and roles decide who reads, writes, publishes and deletes | UC-3 | access-control (partial), sign-in (partial) | yes |
| R4 | must | Datasets are isolated from each other | UC-4 | datasets (verified) | yes |
| R5 | must | Live co-editing: see changes and who is where, never lose an edit | UC-5 | live-listeners (partial), presence (partial), field-patches (partial) | yes |
| R6 | must | Front ends read published content, cached | UC-6 | query-api (partial), delivery-cdn (partial), webhooks (partial) | yes |
| R7 | must | An editing Studio in the browser | UC-7 | studio (unverified) | no |
| R8 | should | Releases publish many documents as one | UC-8 | releases (partial) | yes |
| R9 | should | Revision history and restore | UC-9 | revision-history (partial) | yes |
| R10 | should | Images and files with focal-point crops | UC-10 | assets (partial), image-transforms (unverified) | no |
| R11 | should | Scheduled publishing | UC-11 | scheduling (unverified) | no |
| R12 | could | Search in the Studio and on sites | UC-12 | search (unverified) | no |
| R13 | could | Import from another CMS's export | UC-13 | export-import (partial) | no |
| R14 | wont | Comments and editorial tasks |  | comments-tasks (unverified) | n/a |
| R15 | wont | Visual editing overlays on the live site |  | visual-editing (unverified) | n/a |
| R16 | wont | Hosted add-ons (Canvas, media library service, variants, agents) |  | hosted-addons (not-applicable) | n/a |

Won't, this release:

- **R14 Comments and editorial tasks:** Deferred past v1; buildable later as TapeDB models with live queries.
- **R15 Visual editing overlays on the live site:** Deferred past v1; v1 previews drafts in the Studio.
- **R16 Hosted add-ons (Canvas, media library service, variants, agents):** Hosted services outside the open-source product.

## Actors

- **Developer** (`developer`): Defines content types in code and deploys the CMS to their account.
- **Editor** (`editor`): Writes drafts, publishes, manages releases and assets.
- **Contributor** (`contributor`): Writes drafts; cannot publish.
- **Admin** (`admin`): Everything an editor does, plus deleting documents and managing members.
- **Front end** (`frontend`): A website or app reading published content anonymously.

## Use cases

### UC-1: Define content types

**Actor:** Developer

**Preconditions:**

- A CMS project with TapeDB installed

**Main flow:**

1. Developer declares types and fields in code
2. The CMS compiles them to document and draft models and write rules
3. TapeDB generates a migration
4. Developer commits and deploys

**Alternate flows:**

- A removed field requires an explicit data-loss flag
- An invalid publish sent straight at the model is refused

| acceptance criterion | tests |
| --- | --- |
| Types compile to models; incomplete or invalid publishes are refused, also when sent at the model directly; slugs unique; strong references block deletion | t.fixture-content-model (pass, workerd-local) |

### UC-2: Publish a document

**Actor:** Editor

**Preconditions:**

- Signed in as an editor
- A draft exists

**Main flow:**

1. Editor opens the draft
2. Editor publishes at the draft's revision
3. The document and its revision are written and the draft removed in one transaction
4. Readers see the whole document as one change

**Alternate flows:**

- The document changed since the draft was read: publish refused, nothing changes
- Two publishes from one revision: exactly one lands
- Unpublish removes it from readers

| acceptance criterion | tests |
| --- | --- |
| Readers see nothing before publish and the whole document after; stale and invalid publishes roll back whole | t.fixture-publish (pass, workerd-local) |
| Typed reads and writes work in workerd and deployed | t.select (pass, deployed) |

### UC-3: Work within a role

**Actor:** Contributor

**Preconditions:**

- Members invited with roles

**Main flow:**

1. Contributor signs in
2. Contributor writes drafts
3. Editor publishes them; admin deletes when needed

**Alternate flows:**

- Contributor tries to publish, also straight at the model: refused
- A revoked session stops working

| acceptance criterion | tests |
| --- | --- |
| Reader reads published only; contributor drafts but cannot publish; editor publishes but cannot delete; admin deletes | t.roles (pass, workerd-local) |
| Revoking one session or all others takes effect | t.sessions (pass, workerd-local) |

### UC-4: Keep datasets apart

**Actor:** Developer

**Preconditions:**

- Two datasets in one account

**Main flow:**

1. Each dataset is its own workspace
2. A session is scoped to one dataset

**Alternate flows:**

- A claim for one dataset presented to another: 403

| acceptance criterion | tests |
| --- | --- |
| A claim for one workspace is refused by another (403 wrong_workspace) | t.fixture-isolation (pass, workerd-local) |

### UC-5: Edit together

**Actor:** Editor

**Preconditions:**

- Two editors on the same document

**Main flow:**

1. Both see each other's presence on the document and field
2. Edits to different fields both land and appear live
3. A rich-text field is locked while one editor types

**Alternate flows:**

- The second editor is refused the lock until it is released or expires
- Under load (20 editors autosaving), every save lands

| acceptance criterion | tests |
| --- | --- |
| Different fields land; locked rich text loses no edit; lock races, expiry and maximum hold | t.concurrent-edit (pass, workerd-local) |
| Presence shows who is where | t.presence (pass, deployed) |
| Live views keep order and follow relations | t.live-order (pass, deployed), t.relation-live (pass, deployed) |
| 20 editors x 1 save/s x 30 s with 100 live queries, deployed: no failed save, p99 under 200 ms | t.autosave-load (pass, deployed) |

### UC-6: Serve published content

**Actor:** Front end

**Preconditions:**

- A document is published

**Main flow:**

1. The publish triggers a signed webhook to the delivery Worker
2. The Worker writes the document to R2 by id and slug
3. The front end reads it, cached

**Alternate flows:**

- Unsigned, wrongly signed or old deliveries are refused
- A late delivery of an older revision changes nothing
- Unpublish removes it

| acceptance criterion | tests |
| --- | --- |
| Publish reaches the delivery path, slug changes and unpublish follow, cache hits, bad deliveries refused (deployed) | t.delivery-snapshot (pass, deployed) |
| Webhooks are signed, ordered and retried | t.webhooks (pass, workerd-local) |

### UC-7: Edit in the Studio

**Actor:** Editor

**Preconditions:**

- The Studio served from the CMS Worker

**Main flow:**

1. Editor creates a document from a generated form
2. Edits rich text and an image
3. Reviews the changes and publishes
4. Views the history

**Alternate flows:**

- A reader sees no edit or review controls

| acceptance criterion | tests |
| --- | --- |
| In a browser: create, edit, publish, upload an image, view history | t.studio-smoke (not-run) |

### UC-8: Publish a release

**Actor:** Editor

**Preconditions:**

- Versions of several documents grouped in a release

**Main flow:**

1. Editor publishes the release
2. Every version is applied, revisions written, the release closed, in one transaction

**Alternate flows:**

- One changed or invalid version refuses the whole release
- Two concurrent publishes: one lands; the release cannot be reopened

| acceptance criterion | tests |
| --- | --- |
| A release publishes across types at once; readers never see half; 1,000 versions publish whole | t.fixture-release (pass, workerd-local) |

### UC-9: Restore an earlier revision

**Actor:** Editor

**Preconditions:**

- A document with several revisions

**Main flow:**

1. Editor views revisions with values and writer
2. Restores one into the draft
3. Publishes it as a new revision

**Alternate flows:**

- Revisions cannot be edited or written in another's name

| acceptance criterion | tests |
| --- | --- |
| Each publish and unpublish leaves an immutable revision; restore and republish makes a new one | t.revisions (pass, workerd-local) |

### UC-10: Use images

**Actor:** Editor

**Preconditions:**

- An image field on a type

**Main flow:**

1. Editor uploads an image and sets the focal point
2. Front ends request resized, cropped WebP URLs

**Alternate flows:**

- Private files are not served

| acceptance criterion | tests |
| --- | --- |
| File rules decide reads and writes | t.file-rules (pass, deployed) |
| Resize, focal crop, WebP, cache hit, private refused (deployed) | t.image-transform (fail, deployed) |

### UC-11: Schedule a publish

**Actor:** Editor

**Preconditions:**

- A release ready to publish

**Main flow:**

1. Editor sets a time
2. A Workflow sleeps until then and publishes

**Alternate flows:**

- The schedule changed after it started: the old one does not fire

| acceptance criterion | tests |
| --- | --- |
| A scheduled release publishes at its time; a changed schedule does not fire the old version | t.schedule (not-run) |

### UC-12: Search content

**Actor:** Editor

**Preconditions:**

- Documents saved

**Main flow:**

1. Editor types a query
2. Matching documents appear

| acceptance criterion | tests |
| --- | --- |
| Text search finds a document after save | t.search (not-run) |

### UC-13: Import an export

**Actor:** Developer

**Preconditions:**

- An export tarball from another CMS

**Main flow:**

1. Developer runs the importer
2. Documents, rich text, references and assets are mapped and loaded
3. A report lists rejected documents

| acceptance criterion | tests |
| --- | --- |
| An export imports documents, rich text, references and assets and reports rejects | t.sanity-import (not-run) |

## Traceability

| requirement | use case | tests | passing |
| --- | --- | --- | --- |
| R1 must | UC-1 | t.fixture-content-model | 1/1 |
| R2 must | UC-2 | t.fixture-publish, t.select | 2/2 |
| R3 must | UC-3 | t.roles, t.sessions | 2/2 |
| R4 must | UC-4 | t.fixture-isolation | 1/1 |
| R5 must | UC-5 | t.concurrent-edit, t.presence, t.live-order, t.relation-live, t.autosave-load | 5/5 |
| R6 must | UC-6 | t.delivery-snapshot, t.webhooks | 2/2 |
| R7 must | UC-7 | t.studio-smoke | 0/1 |
| R8 should | UC-8 | t.fixture-release | 1/1 |
| R9 should | UC-9 | t.revisions | 1/1 |
| R10 should | UC-10 | t.file-rules, t.image-transform | 1/2 |
| R11 should | UC-11 | t.schedule | 0/1 |
| R12 could | UC-12 | t.search | 0/1 |
| R13 could | UC-13 | t.sanity-import | 0/1 |

## Diagrams

- [context](diagrams/context.md) (context)
- [container](diagrams/container.md) (container)
- [data-model](diagrams/data-model.md) (data-model)
- [deployment](diagrams/deployment.md) (deployment)
- [seq-model](diagrams/seq-content-model.md) (sequence: UC-1)
- [seq-publish](diagrams/seq-publish.md) (sequence: UC-2, UC-7)
- [seq-access](diagrams/seq-access.md) (sequence: UC-3, UC-4)
- [seq-edit](diagrams/seq-edit.md) (sequence: UC-5)
- [seq-delivery](diagrams/seq-delivery.md) (sequence: UC-6)
- [document-state](diagrams/document-state.md) (state)

## Milestones

| milestone | status | requirements | tests passing |
| --- | --- | --- | --- |
| M1 Content model, publish, roles, isolation | done | R1, R2, R3, R4 | 6/6 |
| M2 Live co-editing and delivery | done | R5, R6 | 7/7 |
| M3 Studio | in-progress | R7 | 0/1 |
| M4 Releases, revisions, assets, scheduling | in-progress | R8, R9, R10, R11 | 3/5 |
| M5 Search and import | planned | R12, R13 | 0/2 |

## Environments

| environment | status | url | version | since | approved by | e2e |
| --- | --- | --- | --- | --- | --- | --- |
| local | deployed |  | examples/cms at 0cedbce | 2026-11-27 |  |  |
| preview | retired |  | temporary cms-fixture-<hex> Workers from scripts/deployed.mjs, deleted after each run | 2026-11-27 |  | t.delivery-snapshot (pass, deployed), t.autosave-load (pass, deployed) |

## Open work

Tests behind a requirement that have not passed, musts first:

- `t.studio-smoke` for R7 (must): not-run, manual. Studio: create, edit, publish, upload an image, view history in a browser
- `t.image-transform` for R10 (should): fail, deployed. Resize, focal-point crop, WebP by default, cache hit on repeat, private files not served; deployed run refused by the account's legacy Image Resizing billing (IMAGES_TRANSFORM_ERROR 9432)
- `t.schedule` for R11 (should): not-run, deployed. A scheduled release publishes at its time; a schedule changed after start does not fire the old version
- `t.search` for R12 (could): not-run, deployed. Text search over the search-document model after save
- `t.sanity-import` for R13 (could): not-run, workerd-local. Import a Sanity datasets export tarball: documents, Portable Text, references, assets; report rejects
