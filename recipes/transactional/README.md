# Transactional state per tenant

**Use when** a tenant's data (an account, an organization, a project) is read
and written together and must stay consistent.

**Shape:** one TapeDB workspace per tenant. Models and relations in
`tapedb.schema.ts`; rules on each model; writes through the typed client or,
from a backend, the admin HTTP API.

**Guarantees:** serializable writes inside a workspace; a transaction is one
log entry; `clientTxId` makes a retry a replay; `upsert` decides inside the
engine and cannot race.

**Design rules**

- Derive what can drift. A stored counter updated by read-modify-write loses
  increments under concurrent writers; a live `count` or `aggregate` cannot.
  The inbox fixture keeps unread as a count of messages after `lastReadAt`.
- Key idempotent writes by the id of what caused them (a message id, a
  provider event id), so a redelivery rewrites the same row.
- Keep a transaction inside one workspace. If a design needs atomicity across
  tenants, the boundary is wrong, or it needs a saga with reconciliation.
- Spell out defaulted fields in admin-API inserts (0.4.2 does not fill them).

**Tested by:** `examples/inbox` (conversations, messages, unread, 30
concurrent sends, isolation) and `examples/ingest` (idempotent upserts from a
consumer).
