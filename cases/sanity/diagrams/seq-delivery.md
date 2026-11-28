# UC-6 Serve published content

```mermaid
sequenceDiagram
  participant W as Workspace
  participant H as CMS Worker /_cms/hook
  participant R2 as R2 content
  actor F as Front end
  W->>H: signed webhook: post published, rev n
  alt bad signature, too old, or rev older than stored
    H-->>W: refused or ignored
  else
    H->>R2: write by id and slug; purge cache
    H-->>W: 200
  end
  F->>H: GET /content/post/slug
  H->>R2: read (Cache API in front)
  H-->>F: document
```
