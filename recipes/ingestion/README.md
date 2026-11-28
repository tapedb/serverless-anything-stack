# High-volume ingestion

**Use when** clients send events faster than a tenant's writer should absorb
them: error reports, telemetry, logs, analytics beacons.

**Shape:** an ingest Worker authenticates the sender (a project key), bounds
the size, and acknowledges only after `Queue.send`/`sendBatch` resolves. A
consumer turns events into control-plane state in TapeDB (an issue, a
counter, an alert) and sends raw events to the data plane (`analytics`
recipe). Raw events never go into a workspace.

**Design rules**

- Durable before acknowledged: the queue holds the event when the client
  hears 200.
- Identity is deterministic (a fingerprint), not similarity; similarity is a
  suggestion.
- Counts are sums of per-message tallies keyed by message id, so a
  redelivery does not double count and nothing is read-modify-written.
- Per-message acks and a dead-letter queue with a recorder.
- Backpressure: queue depth and consumer concurrency are the dials; one
  tenant's burst should not starve others (one queue per tier, or per-tenant
  limits at the edge).

**Test in the application:** intake to a queue, an idempotent consumer, a
dead-lettered poison message, then deployed Queues, burst load, late events
and privacy redaction.
