# Diagram starting points

One diagram per file under `docs/serverless/diagrams/`, registered in
`project.json` `diagrams`. Replace the example names; keep every Cloudflare
primitive explicit so the diagram matches the assessment's components.

## context (`diagrams/context.md`)

```mermaid
flowchart LR
  owner([Owner]) -->|browser| app[The application]
  dev([Collaborator]) -->|git over HTTPS| app
  app -->|email| mail[(Email provider)]
  app -->|webhooks| ext[(External systems)]
```

## container (`diagrams/container.md`)

```mermaid
flowchart LR
  browser([Browser]) --> worker[Worker: UI + API]
  git([Git client]) --> artifacts[(Artifacts namespace)]
  worker --> ws[(TapeDB workspace per tenant)]
  worker --> artifacts
  artifacts -- push events --> queue[[Queue]] --> consumer[Worker: consumer]
  consumer --> ws
  worker --> r2[(R2 bucket)]
```

## data-model (`diagrams/data-model.md`)

```mermaid
erDiagram
  ACCOUNT ||--o{ REPOSITORY : owns
  REPOSITORY ||--o{ ISSUE : has
  ACCOUNT ||--o{ MEMBERSHIP : has
  REPOSITORY ||--o{ MEMBERSHIP : grants
```

## deployment (`diagrams/deployment.md`)

```mermaid
flowchart TB
  subgraph account[Cloudflare account]
    subgraph prod[production]
      w1[Worker app] --- b1[(bindings: prod)]
    end
    subgraph staging[staging]
      w2[Worker app-staging] --- b2[(bindings: staging)]
    end
    subgraph previews[Previews]
      w3[Preview per branch] --- b3[(bindings: previews block)]
    end
  end
  ci[GitHub Actions] --> previews & staging
  ci -->|owner approves| prod
```

## sequence (`diagrams/uc-1.md`, `covers: ["UC-1"]`)

```mermaid
sequenceDiagram
  actor U as Owner
  participant W as Worker
  participant T as TapeDB workspace
  participant A as Artifacts
  U->>W: POST /repos {name}
  W->>T: check membership and quota
  alt refused
    T-->>W: 403
    W-->>U: 403
  else allowed
    W->>A: create(name)
    A-->>W: remote, token
    W->>T: insert repository row
    W-->>U: 201 {remote}
  end
```

## state (`diagrams/pull-request-state.md`)

```mermaid
stateDiagram-v2
  [*] --> open
  open --> merged: merge
  open --> closed: close
  closed --> open: reopen
  merged --> [*]
```
