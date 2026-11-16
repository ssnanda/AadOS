# Security gates

- The web workspace requires the owner login stored as a scrypt hash in OpenShift. `--reset-user` rotates the credentials and invalidates existing signed sessions.
- Never place secrets in GitHub, Docker build arguments, deployment manifests, or logs. Provide `SECRET_KEY_BASE` using the namespace Secret `aados-api-secrets` (key `secret_key_base`).
- `AADOS_ENABLE_DATABASE` is false by default until PostgreSQL/credentials are provisioned.
- No email provider connection, token persistence, Gmail/Graph API access, or email state changes occur in this release.
- Before enabling live email access: implement MFA/WebAuthn, OAuth PKCE/state validation, encrypted token storage, RLS authorization, logging without email contents, and security tests.
- Before enabling AI/sending: require separate explicit confirmation for sending, deleting, archiving, bulk operations and other provider mutations. Prefer narrow read-only scopes.
- Never automatically deploy production without explicit confirmation. Restrict OpenShift secrets/service accounts and set resource limits.
