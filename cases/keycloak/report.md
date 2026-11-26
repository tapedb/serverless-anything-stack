# Keycloak: assessment

Generated from `assessment.json` by `bun scripts/report.ts`. Do not edit by hand.

- **Upstream:** https://github.com/keycloak/keycloak at `3e5160added9fd6543702c6984f2a6828502cfcd` (inspected 2026-11-26)
- **License:** Apache-2.0
- **Approach:** compatible-rewrite
- **Capabilities:** 3 verified, 5 partial, 6 unverified, 4 unsupported

## Architecture

Not a port. A compatible OIDC provider on Workers using Better Auth and its OAuth 2.1 provider plugin, storing everything in TapeDB's AuthRoom, with realms modelled as separate deployments or as an explicit tenant key. SAML, federation and custom flows stay out of scope unless an application needs them.

| component | primitive | responsibility |
| --- | --- | --- |
| Auth Worker | Workers + Better Auth | OIDC endpoints, sign-in, MFA, consent |
| AuthRoom | TapeDB AuthRoom (SQLite Durable Object) | users, sessions, accounts, verification values, OAuth clients and tokens, plugin tables |
| Workspaces | TapeDB workspaces | application data, keyed by membership the AuthRoom holds |

## Capability matrix

| capability | status | decision | candidate | gaps | tests |
| --- | --- | --- | --- | --- | --- |
| Token revocation | verified | reuse | @better-auth/oauth-provider /oauth2/revoke on TapeDB |  | t.revoke (pass, workerd-local) |
| Sessions, listing and invalidation, including on ban | verified | reuse | Better Auth sessions in TapeDB's AuthRoom |  | t.sessions (pass, workerd-local), t.ban (pass, workerd-local) |
| TOTP and single-use backup codes | verified | reuse | Better Auth twoFactor plugin on TapeDB |  | t.totp (pass, workerd-local) |
| Authorization code grant with PKCE; a code redeems once | partial | reuse | @better-auth/oauth-provider on TapeDB's Better Auth adapter | No OpenID conformance suite run. PAR, RAR and resource indicators (present upstream) not checked. Consent UI is the application's to build. | t.pkce-race (pass, workerd-local), t.oidc-conformance (not-run) |
| Refresh-token rotation, single use, with reuse detection | partial | reuse | @better-auth/oauth-provider refresh grant on TapeDB | Offline-token semantics and per-client refresh policies (upstream) not mapped. | t.refresh-race (pass, workerd-local) |
| Dynamic client registration and client management | partial | reuse | @better-auth/oauth-provider /oauth2/register on TapeDB | Registration writes inside runWithTransaction; the adapter has no multi-call transactions, so a failure part-way can leave a client without its resource bindings. Client policies (upstream) not mapped. | t.pkce-race (pass, workerd-local) |
| Discovery document, JWKS and key rotation | partial | reuse | Better Auth jwt plugin and oauth-provider well-known endpoints | JWT kid matches the published JWKS (tested); key rotation not tested. Discovery document contents not compared with upstream. | t.jwks (pass, workerd-local), t.key-rotation (not-run) |
| WebAuthn registration and sign-in | partial | reuse | @better-auth/passkey on TapeDB | Only registration options were tested; no authenticator ceremony. Registration with a session writes inside runWithTransaction. | t.passkey-options (pass, workerd-local), t.passkey-ceremony (not-run) |
| RP-initiated, front-channel and back-channel logout | unverified | reuse | @better-auth/oauth-provider /oauth2/end-session | The end-session route exists in the plugin; nothing was tested. Back-channel logout not found in the plugin. | t.logout (not-run) |
| Realms: separate users, clients, keys and configuration | unverified | extend | One deployment (and AuthRoom) per realm, or a tenant column enforced in every auth query | TapeDB workspaces are not realms: users, keys and clients live in the deployment-wide AuthRoom. No tenant-scoped Better Auth configuration exists today. | t.realm-isolation (not-run) |
| Attack detection and lockout | unverified | reuse | Better Auth rate limiter (incrementOne) plus TapeDB claim limits | Keycloak's permanent and temporary lockout policies are not mapped. | t.lockout (not-run) |
| Admin and login events | unverified | extend | TapeDB audit for workspace writes; Better Auth hooks writing events for auth | TapeDB's audit covers workspace writes, not AuthRoom changes. | t.audit (not-run) |
| SCIM provisioning | unverified | exclude | Not assessed | Not assessed. |  |
| Verifiable credential issuance | unverified | exclude | Not assessed | Not assessed. |  |
| SAML 2 identity provider | unsupported | external | None in TapeDB; an external IdP or a dedicated library if an application needs it | Out of TapeDB's scope by design. |  |
| LDAP, Kerberos and SSSD federation | unsupported | exclude | None; LDAP and Kerberos need network protocols Workers cannot serve as a directory client in the general case | Workers can open TCP sockets, but a Kerberos realm and LDAP bind flows were not assessed. |  |
| Admin-configurable authentication flows | unsupported | exclude | Application code around Better Auth hooks | No configurable flow engine; flows are code. |  |
| Authorization services (policies, permissions, UMA) and AuthZEN | unsupported | exclude | TapeDB access rules for application data; no policy server | TapeDB rules guard TapeDB data only; there is no general policy decision point. |  |

## Tests

| test | runtime | result | ran | command |
| --- | --- | --- | --- | --- |
| Authorization code with PKCE; wrong verifier refused; three concurrent redemptions, at most one succeeds | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| Refresh rotation once under a race; replay revokes the family | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| A revoked refresh token is refused | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| The session JWT's kid is in /jwks | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| Revoke one session and the others | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| A ban ends sessions and refuses sign-in | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| TOTP enrolment and second factor; one backup code succeeds once under a race | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |
| Registration options issued and challenge stored | workerd-local | pass | 2026-11-26 | `bun run test:auth (tapedb 0.4.1)` |

Not run yet (the backlog):

- `t.oidc-conformance` (deployed): OpenID Foundation conformance suite against the deployed provider
- `t.key-rotation` (workerd-local): Signing key rotation keeps old tokens verifiable until expiry
- `t.logout` (workerd-local): End-session and back-channel logout
- `t.passkey-ceremony` (manual): Full WebAuthn ceremony with a virtual authenticator
- `t.realm-isolation` (workerd-local): Two realms cannot see each other's users, clients or keys
- `t.lockout` (workerd-local): Repeated failures lock an account per policy
- `t.audit` (workerd-local): Auth and admin events are recorded

## Risks

- **Multi-step Better Auth flows can leave partial writes on failure.** Identify each flow in runWithTransaction (AUTH-COMPATIBILITY.md) and add reconciliation or idempotent retry in the application.
- **One AuthRoom serves every sign-in and token refresh of a deployment.** Benchmark auth write throughput before launch; shard by deployment (realm) if it does not hold.
- **An identity provider is a high-value target and no parity is claimed.** Conformance suite plus an independent security review are release gates.

## Decisions

### Rewrite a compatible OIDC provider rather than port Keycloak (proposed)

Keycloak is a Quarkus/JVM server with JPA and Infinispan; none of it runs in Workers.

- Port Keycloak: No JVM in Workers; would need containers, which is a VPS by another name.
- **Compatible rewrite on Better Auth and TapeDB** (chosen): Reuses verified primitives (sessions, MFA, OAuth provider); drops SAML, federation and configurable flows; no parity.
- Use an external IdP: Least work and full protocol coverage; not serverless-on-Cloudflare.

The OIDC subset an application needs is covered and tested; SAML, LDAP and custom flows are external or excluded.

## Cost drivers

- **AuthRoom requests and rows:** Each sign-in and token refresh is one or more AuthRoom calls; volumes not modelled yet. (cf.do-pricing)

## Workload assumptions

- Interactive sign-ins dominate writes; token refreshes dominate requests.
- All of one deployment's auth state sits in a single AuthRoom, so sign-in and token write throughput is one Durable Object's. Not measured for auth traffic yet.

## Upstream dependencies

- Quarkus (JVM): application runtime
- Relational database (JPA): realms, users, clients, credentials
- Infinispan: session caches and cluster coordination
