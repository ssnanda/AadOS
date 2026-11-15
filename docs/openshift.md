# OpenShift deployment

Current chart targets `aados-dev` and `aados-prod` using separate values overlays. Do not confuse this project with other OpenShift deployments.

Required environment and resources:

1. Log in with `oc login`, select the intended cluster and verify namespace access. Pre-create the namespace (`aados-dev` or `aados-prod`).
2. Create namespace Secret `aados-api-secrets` with key `secret_key_base` via your approved secrets manager. Do not store a literal secret in Git.
3. Build and push API/web images from `apps/api/Dockerfile` and `apps/web/Dockerfile` to your configured registry. Set `API_IMAGE` and `WEB_IMAGE` to the full immutable image references.
4. Run `AADOS_ENV=dev API_IMAGE=... WEB_IMAGE=... bin/deploy-openshift.sh`. Production additionally requires an explicit interactive confirmation.
5. Services are **ClusterIP only**. Until authentication is implemented, use an access-controlled `oc port-forward` for testing, not a public Route.

The script does not create namespaces or deploy a database. The chart starts the API with `AADOS_ENABLE_DATABASE=false` until the supported Postgres/CloudNativePG deployment and migrations are implemented. Image pull credentials and SCC permissions are the cluster administrator's responsibility.

The bootstrap chart does not provide production readiness, backup automation, TLS edge routing or a release promotion workflow. Do not deploy it to production for live email use.
