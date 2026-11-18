# OpenShift deployment (oc only; no Helm)

AadOS follows the AJOPS `oc-deploy.sh` approach: OpenShift `ImageStream` + binary `BuildConfig` + `oc start-build --from-dir` + `oc apply` of private Kubernetes resources. **You only need `oc` plus a logged-in session on your Mac.** Neither Helm nor a Docker daemon nor an external image registry is required for the OpenShift path. The OpenShift cluster must support BuildConfigs and its internal registry.

## Development (recommended)

1. On your Mac, check `oc whoami` and `oc get nodes`.
2. Run `./bin/pull-latest.sh` in a clean checkout to get the current code.
3. Run `./bin/oc-deploy.sh` from the AadOS repository. If there are local changes it first runs `./bin/bump.sh --if-dirty` to commit and push them to GitHub, then builds the current source in OpenShift. The commit carries `[skip ci]`, so it does not start GitHub Actions. The first deploy creates a random login and prints the password once.
4. The script creates `aados` only if it does not exist and generates the `aados-api-secrets` development secret only when absent. It processes `openshift/build.yaml`, builds both Dockerfiles in OpenShift from `apps/api` and `apps/web`, processes `openshift/app.yaml`, and verifies both rollouts.
5. Visit `https://os.aadnanda.com`. For local access, run `oc port-forward -n aados svc/aados-web 3000:3000`, then visit `http://127.0.0.1:3000`.

Use `AADOS_NAMESPACE=<namespace> ./bin/oc-deploy.sh` to override the project, `AADOS_HOST=<hostname>` to override the public hostname, or `CERT_MANAGER_CLUSTER_ISSUER=<issuer>` to override the certificate issuer. To see results: `oc get pods,deploy,svc,ingress,route -n aados`. Deployment logs are in `build/deploy/` (gitignored).

Normal deploys keep the existing username and password hash. Run `./bin/oc-deploy.sh --reset-user` to generate a new login, print its password once, and invalidate all existing browser sessions. Set `AADOS_LOGIN_USER` only when resetting if you want a specific username.

## Production boundary

`AADOS_ENV=prod ./bin/oc-deploy.sh` requires typing `DEPLOY-PROD`, an **existing** production namespace and a pre-created `aados-api-secrets` with key `secret_key_base`. Production deployments are discouraged until database migrations, operational backups and provider authorization are implemented. The deployment creates a password-protected, cert-manager-backed HTTPS Ingress; do not ingest personal email until OAuth and per-account authorization are implemented.

## Notes

- The current app has one password-protected owner workspace but no OAuth provider connections. It serves a read-only empty inbox and health endpoints.
- DNS for `os.aadnanda.com` must point to the OpenShift router. The default certificate issuer is `letsencrypt-prod`, which has the Cloudflare DNS solver used by existing `aadnanda.com` certificates.
- `aados-web-data` is a 1 GiB persistent volume. Zoho OAuth credentials, folder mappings, cursors and parsed items are encrypted before being written there with a key derived from `secret_key_base`.
- Register `https://os.aadnanda.com/oauth/zoho/callback` in the Zoho API Console. The app requests read-only account, folder and message scopes.
- PostgreSQL 16 (`aados-db`, image `quay.io/sclorg/postgresql-16-c9s`, 5 Gi PVC `aados-db-data`) is primary storage since v0.1.64. The API runs migrations on start; the web app imported `state.enc` once (file kept). Rollback: set web `AADOS_STORAGE=file` (changes made since then exist only in PostgreSQL).
- `aados-api-secrets` keys: `secret_key_base`, `aados-user`, `aados-password-hash`, `postgres-password`, `credential-encryption-key` (base64 of 32 bytes; encrypts mail/OAuth/AI tokens in PostgreSQL — **back it up; losing it means reconnecting every account**), `internal-api-token`. `bin/oc-deploy.sh` only creates `secret_key_base` and the login keys today; on a fresh namespace add the other three first (see 2026-11-18 handoff in roadmap item 63).
- OpenShift builds use each app's Dockerfile; the cluster's internal image registry stores `aados-api:latest` and `aados-web:latest` in the target namespace.
- The script uses `oc` against your **currently logged-in cluster**, but never changes your default namespace. Confirm cluster/context before deploying.
- `bin/dev-local.sh` uses Docker Compose for optional local-only testing, not for OpenShift.
- Pending local changes are committed and pushed via `bin/bump.sh` before deploying. The commit carries `[skip ci]`, like every `bump.sh` commit; start CI manually from GitHub Actions if wanted.
