# Security gates

- v0.1.1 is **not authenticated** and must remain private. OpenShift deployment creates ClusterIP services only; no Route or Ingress resources.
- Never place secrets in GitHub, Docker build arguments, deployment manifests, or logs. Provide `SECRET_KEY_BASE` using the namespace Secret `aados-api-secrets` (key `secret_key_base`).
- `AADOS_ENABLE_DATABASE` is false by default until PostgreSQL/credentials are provisioned.
- No email provider connection, token persistence, Gmail/Graph API access, or email state changes occur in this release.
- Before enabling public access: implement account authentication, session security, MFA/WebAuthn, CSRF and OAuth PKCE/state validation, encrypted token storage, RLS authorization, logging without email contents, throttling, and security tests.
- Before enabling AI/sending: require separate explicit confirmation for sending, deleting, archiving, bulk operations and other provider mutations. Prefer narrow read-only scopes.
- Never automatically deploy production without explicit confirmation. Restrict OpenShift secrets/service accounts and set resource limits.
