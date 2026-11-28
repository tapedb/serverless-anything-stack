# UC-1 Define content types

```mermaid
sequenceDiagram
  actor D as Developer
  participant C as CMS compiler
  participant T as tapedb CLI
  participant W as Workspace
  D->>C: defineContent(types)
  C-->>D: document and draft models, check() rules
  D->>T: tapedb migrate dev
  alt field removed
    T-->>D: refused without --accept-data-loss
  else field added
    T-->>D: migration file
  end
  D->>W: deploy; publish with a missing required field
  W-->>D: refused by check()
```
