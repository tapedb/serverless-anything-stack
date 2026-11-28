# Analytical storage and reporting

**Use when** questions span many tenants or long periods: event search,
retention windows, reports across accounts.

**Shape:** within one tenant, TapeDB aggregates (`count`, `aggregate`,
`groupBy`) and named SQL, live where needed. Across tenants or at event
volume, a data plane: Basin Pipelines into R2 Iceberg tables, partitioned by
tenant and time, queried with Basin SQL. Analytics Engine only for sampled
metrics.

**Design rules**

- TapeDB is not a warehouse; one workspace, one writer.
- Partition so a query scans one tenant and one time range; Basin SQL bills
  per TB scanned.
- Retention is partition expiry in the data plane and a scheduled deletion in
  TapeDB; say which data lives where.
- Interactive views over Basin SQL need a latency measurement before they are
  promised; keep the newest items a screen needs in the workspace.

**Tested by:** nothing here yet. A capability that depends on Basin stays
`unverified` until the application's own tests run against it.
