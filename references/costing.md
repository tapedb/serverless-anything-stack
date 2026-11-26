# Costing

A cost estimate is a list of drivers, each with a stated volume, a unit price
from an official pricing page (as `pricing` evidence with `checkedAt`), and
the arithmetic. Where a price is unknown, write `UNPRICED` and say what is
missing. The validator refuses a cost assumption whose source is not pricing
evidence.

## Drivers to list

- **Workers:** requests, CPU time.
- **Durable Objects (TapeDB):** requests (every write, every socket message,
  every live re-run is one or more), duration, and SQLite rows read and
  written. Rows read is the figure TapeDB's `/queries` profile reports, and it
  is what Cloudflare bills; on Workers Paid, 25 billion rows read and 50
  million rows written are included each month, then $0.001 per million read
  and $1 per million written (2026-11-26). Live queries re-run on matching
  writes, so reads scale with subscribers times writes.
- **Queues:** about three operations per message (write, read, delete), plus
  one read per retry.
- **R2:** storage, class A and class B operations; egress is free.
- **Basin SQL:** bytes scanned ($2.50 per TB, 2026-11-26); partition tables so
  a query scans one tenant and one time range.
- **Vectorize, Workflows, Analytics Engine:** per their pricing pages.

## Discipline

- Separate averages from bursts, storage from operations, free allowances
  from paid rates.
- A volume is an assumption; write it in `workloadAssumptions`.
- Benchmarks come from runs with their environment recorded (local or
  deployed), never from expectations. TapeDB's `BENCHMARKS.md` labels its runs.
