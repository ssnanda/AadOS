# AadOS

AadOS is an independent, self-hosted personal AI operating system. **Email is the first priority.** The initial application is a Phoenix JSON API and SvelteKit read-only dashboard with an explicitly empty/not-connected inbox. No provider credentials, messages, or tokens are shipped.

## Current status

- Version: see `VERSION` (development; local Docker stack, no production deployment).
- Email: Gmail and Zoho Mail (read-only), unified inbox, categories, Needs Reply, search.
- Calendar: Google and Zoho Calendar (read-only, owner consent pending), month/week/day/agenda.
- Tasks, reminders with notification center and browser notifications, daily dashboard.
- AI (Phase 3): assistant, email insights, reply drafts, daily briefing — via the owner's AJMCP gateway; off until enabled.
- Documents (Phase 3): uploads to the owner's RustFS bucket, text extraction, full-text search, document questions.
- Storage: PostgreSQL primary locally (`AADOS_STORAGE=postgres`); credentials encrypted with a dedicated key.
- See `docs/architecture.md`, `docs/roadmap.md` and `docs/development-handoff.md`.

## Scripts

| Command | Purpose |
| --- | --- |
| `./bin/pull-latest.sh` | Safely fast-forward clean local checkout from GitHub |
| `./bin/bump.sh` | Patch-default version bump, commit, tag and push (option 5 = no bump) |
| `./bin/dev-local.sh` | Local Docker Compose rebuild (bumps pending changes first), refresh, logs, stop, shell, test or config |
| `./bin/oc-deploy.sh` | Deploy to OpenShift using `oc`, binary BuildConfigs and internal registry; no Helm |
| `./bin/build-ipa.sh` | Signed IPA build; requires a future native Xcode project |

None of these scripts start GitHub Actions: every commit made by `bump.sh` carries `[skip ci]`. `dev-local.sh rebuild` and `oc-deploy.sh` run `bump.sh` first when there are pending changes.

## OpenShift — using your existing oc login

From a clean AadOS Git checkout on your Mac:

```sh
./bin/pull-latest.sh
./bin/oc-deploy.sh
```

This targets `aados` by default. It creates the project if needed, generates the application secrets and first login when missing, builds both images inside OpenShift from source, and applies the services, deployments, and HTTPS Ingress. **Neither Helm nor Docker is needed on your Mac for OpenShift deployment.** The OpenShift cluster must support BuildConfigs and the internal image registry.

Open `https://os.aadnanda.com` and use the login printed on the first deployment. To rotate it later:

```sh
./bin/oc-deploy.sh --reset-user
```

For local cluster access, run `oc port-forward -n aados svc/aados-web 3000:3000` and open http://127.0.0.1:3000. To select another namespace, set `AADOS_NAMESPACE`. Production requires `AADOS_ENV=prod` and explicit `DEPLOY-PROD` confirmation. See [OpenShift instructions](docs/openshift.md).

## Optional local development

`./bin/dev-local.sh` requires Docker and Docker Compose. It generates gitignored `.env.local` with a local development-only secret if absent, builds API/web containers, and binds them to localhost. Web: http://127.0.0.1:3000; API: http://127.0.0.1:4000.

For native development without Docker, use Elixir >= 1.17 / Node >= 22, run `mix deps.get` then `mix phx.server` in `apps/api` with `SECRET_KEY_BASE` and `AADOS_ENABLE_DATABASE=false`, and run `npm install && npm run dev` in `apps/web` with `AADOS_API_URL=http://localhost:4000`.

## Source layout

- `apps/api`: Phoenix, Ecto, Oban foundation; DB disabled in bootstrap.
- `apps/web`: SvelteKit dashboard.
- `openshift`: ImageStreams, binary builds, private deployments and services.
- `charts/aados`: retained legacy Helm chart (not required by `oc-deploy.sh`).
- `bin`: Git, local development, OpenShift and iOS scripts.
- `docs`: [Architecture](docs/architecture.md), [Roadmap](docs/roadmap.md), [Security](docs/security.md).

**Security:** The public workspace is password protected. Do not enable live email ingestion until OAuth, RLS/authorization and encrypted credentials are implemented.
