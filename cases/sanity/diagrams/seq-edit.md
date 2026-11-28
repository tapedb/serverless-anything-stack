# UC-5 Edit together

```mermaid
sequenceDiagram
  actor A as Editor A
  actor B as Editor B
  participant W as Workspace
  A->>W: presence {doc, field: body}
  W-->>B: A is on body
  A->>W: take lock on body (at most 30 s)
  W-->>A: ok
  B->>W: take lock on body
  W-->>B: refused until released or expired
  B->>W: write title
  W-->>A: live: title changed
  A->>W: write body, release lock
  W-->>B: live: body changed; lock free
```
