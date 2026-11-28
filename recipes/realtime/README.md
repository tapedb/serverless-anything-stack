# Live views, presence and ephemeral signals

**Use when** screens must update as data changes (inboxes, boards, dashboards)
or users need to see each other (typing, availability, cursors).

**Shape:** TapeDB live queries for anything derived from stored data;
presence rooms for who is here; broadcast topics for ephemeral signals that
are never stored. One socket per workspace per client carries all three.

**Do not** add a WebSocket Durable Object per room or a pub/sub service next
to it: that is a second source of truth and a second socket. The validator
refuses it unless an exception records why (for example, binary media frames).

**Design rules**

- Subscribe to the query the screen shows; diffs arrive at row level, batched
  at 50 ms after a commit.
- Scope presence rooms small (an inbox, a document). Fan-out grows with the
  square of the room.
- Presence ends with the socket. A "seen in the last 90 s" rule is a stored
  timestamp, not presence.
- Each live query re-runs on matching writes; count that in reads and cost.

**Tested by:** `examples/inbox` (a live count updated by another client) and
TapeDB's own e2e scenarios (`live-order`, `relation-live`, `presence`,
`broadcast`), which passed on deployed staging.
