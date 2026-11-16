# AadOS

AadOS is an independent, self-hosted personal AI operating system. **Email is the first priority.** The initial application is a Phoenix JSON API and SvelteKit read-only dashboard with an explicitly empty/not-connected inbox. No provider credentials, messages, or tokens are shipped.

## Current status

- Version: **0.1.1** (bootstrap, not a connected email MVP).
- API: Elixir/Phoenix health and email overview/messages endpoints.
- Web: SvelteKit 2 / Svelte 5 / Tailwind CSS 4 dashboard.
- Future: secure identity, Gmail and Outlook read-only OAuth, CloudNativePG/Postgres, AI triage and SwiftUI app.
- No public Route/Ingress until authentication, authorization, encrypted token storage and security checks are implemented.

## Scripts

| Command | Purpose |
| --- | --- |
| `./bin/pull-latest.sh` | Safely fast-forward clean local checkout from GitHub |
| `./bin/bump.sh` | Patch-default version bump, commit, tag and push (option 5 = no bump) |
| `./bin/dev-local.sh` | Local-only Docker Compose rebuild, refresh, logs, stop or shell |
| `./bin/oc-deploy.sh` | Deploy to OpenShift using `oc`, binary BuildConfigs and internal registry; no Helm |
| `./bin/build-ipa.sh` | Signed IPA build; requires a future native Xcode project |

The legacy `bin/push.sh` command remains available as an alias.

## OpenShift — using your existing oc login

From a clean AadOS Git checkout on your Mac:

```sh
./bin/pull-latest.sh
./bin/oc-deploy.sh
```

This targets `aados-dev` by default. It creates the development project if needed, generates a development Phoenix secret (only if missing), builds both images inside OpenShift from source, and applies two private services and deployments. **Neither Helm nor Docker is needed on your Mac for OpenShift deployment.** The OpenShift cluster must support BuildConfigs and the internal image registry.

Access the UI securely through your existing `oc` login:

```sh
oc port-forward -n aados-dev svc/aados-web 3000:3000
```

Open http://127.0.0.1:3000. To select an existing namespace, set `AADOS_NAMESPACE`. Production requires `AADOS_ENV=prod` and explicit `DEPLOY-PROD` confirmation; do not deploy this unauthenticated bootstrap publicly. See [OpenShift instructions](docs/openshift.md).

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

**Security:** No public exposure or live email ingestion until login, OAuth, RLS/authorization and encrypted credentials are implemented.
