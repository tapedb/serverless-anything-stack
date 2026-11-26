# Identity: sign-in, sessions, an OAuth provider

**Use when** the application signs users in, or must act as an OAuth 2.1 /
OIDC provider for other applications.

**Shape:** TapeDB built-in auth (Better Auth on the AuthRoom) for users,
sessions, credentials and workspace membership. For a provider, add Better
Auth's OAuth provider plugin; TOTP, passkeys, JWT/JWKS and admin bans are
plugins too. Workspace roles come from membership.

**What is verified** (TapeDB 0.4.1, AUTH-COMPATIBILITY.md, 11 tests in
workerd): session revocation, bans, magic links, TOTP and backup codes,
organizations, JWT/JWKS, authorization code with PKCE, refresh rotation with
reuse detection, revocation, device authorization, passkey registration
options. Every single-use step is raced and succeeds at most once.

**What is not:** an OpenID conformance run, key rotation, logout variants, a
full WebAuthn ceremony, account linking, SAML, LDAP, configurable flows.

**Design rules**

- Realms are not workspaces. Users, keys and clients live in the
  deployment's AuthRoom; separate realms are separate deployments or an
  explicit tenant key enforced everywhere.
- Flows Better Auth writes inside `runWithTransaction` can leave partial
  writes; add reconciliation or idempotent retry around them.
- One AuthRoom serves a deployment's sign-ins: measure before launch.
- Conformance and an independent security review are release gates.

**Tested by:** TapeDB's `bun run test:auth`. No fixture here: identity
fixtures wait until the adapter's gaps above are closed (handoff gate).
