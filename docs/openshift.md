# OpenShift deployment (oc only; no Helm)

AadOS follows the AJOPS `oc-deploy.sh` approach: OpenShift `ImageStream` + binary `BuildConfig` + `oc start-build --from-dir` + `oc apply` of private Kubernetes resources. **You only need `oc` plus a logged-in session on your Mac.** Neither Helm nor a Docker daemon nor an external image registry is required for the OpenShift path. The OpenShift cluster must support BuildConfigs and its internal registry.

## Development (recommended)

1. On your Mac, check `oc whoami` and `oc get nodes`.
2. Run `./bin/pull-latest.sh` in a clean checkout to get the current code.
3. Run `./bin/oc-deploy.sh` from the AadOS repository. This runs `./bin/bump.sh --if-dirty` first if any local changes need committing and pushing to GitHub. The first deploy creates a random login and prints the password once.
4. The script creates `aados` only if it does not exist and generates the `aados-api-secrets` development secret only when absent. It processes `openshift/build.yaml`, builds both Dockerfiles in OpenShift from `apps/api` and `apps/web`, processes `openshift/app.yaml`, and verifies both rollouts.
5. Visit `https://os.aadnanda.com`. For local access, run `oc port-forward -n aados svc/aados-web 3000:3000`, then visit `http://127.0.0.1:3000`.

Use `AADOS_NAMESPACE=<namespace> ./bin/oc-deploy.sh` to override the project, `AADOS_HOST=<hostname>` to override the public hostname, or `CERT_MANAGER_CLUSTER_ISSUER=<issuer>` to override the certificate issuer. To see results: `oc get pods,deploy,svc,ingress,route -n aados`. Deployment logs are in `build/deploy/` (gitignored).

Normal deploys keep the existing username and password hash. Run `./bin/oc-deploy.sh --reset-user` to generate a new login, print its password once, and invalidate all existing browser sessions. Set `AADOS_LOGIN_USER` only when resetting if you want a specific username.

## Production boundary

`AADOS_ENV=prod ./bin/oc-deploy.sh` requires typing `DEPLOY-PROD`, an **existing** production namespace and a pre-created `aados-api-secrets` with key `secret_key_base`. Production deployments are discouraged until database migrations, operational backups and provider authorization are implemented. The deployment creates a password-protected, cert-manager-backed HTTPS Ingress; do not ingest personal email until OAuth and per-account authorization are implemented.

## Notes

- The current app has one password-protected owner workspace but no OAuth provider connections. It serves a read-only empty inbox and health endpoints.
- DNS for `os.aadnanda.com` must point to the OpenShift router. The default certificate issuer is `letsencrypt-prod`, which has the Cloudflare DNS solver used by existing `aadnanda.com` certificates.
- `AADOS_ENABLE_DATABASE=false` until CloudNativePG/PostgreSQL and migrations are configured.
- OpenShift builds use each app's Dockerfile; the cluster's internal image registry stores `aados-api:latest` and `aados-web:latest` in the target namespace.
- The script uses `oc` against your **currently logged-in cluster**, but never changes your default namespace. Confirm cluster/context before deploying.
- `bin/dev-local.sh` uses Docker Compose for optional local-only testing, not for OpenShift.
