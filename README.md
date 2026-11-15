# AadOS

AadOS is an independent, self-hosted personal AI operating system. **Email is the first priority.** This repository starts with a read-only email dashboard shell and a Phoenix JSON API that explicitly reports no connected accounts. No email is ingested, modified, sent, or deleted by this release.

## Version and scope

`VERSION`: **0.1.0** — initial bootstrap. This is a working **foundation**, not a connected-email MVP. The dashboard displays real API connection state, including offline handling; no sample messages are presented as actual mail.

## Layout

- `apps/api`: Phoenix/Elixir JSON API, Ecto/PostgreSQL and Oban foundations (DB optional during bootstrap)
- `apps/web`: SvelteKit 2 / Svelte 5 / TypeScript / Tailwind CSS 4 dashboard
- `charts/aados`: private-by-default OpenShift Helm resources
- `bin`: safe pull, patch-default push, iOS build and OpenShift deployment scripts
- `docs`: rollout, security, architecture, next milestones

## Local development

Prerequisites: Elixir >= 1.17 and Erlang/OTP compatible with it; Node.js >= 22 and npm; optionally PostgreSQL 16+.

**API**

```sh
cd apps/api
mix local.hex --force
mix deps.get
export SECRET_KEY_BASE="$(mix phx.gen.secret)"
export AADOS_ENABLE_DATABASE=false
mix phx.server
```

The API listens at `http://localhost:4000`. Check `GET /api/health` and `GET /api/v1/email/overview`.

**Web (separate terminal)**

```sh
cd apps/web
npm install
AADOS_API_URL=http://localhost:4000 npm run dev -- --host 127.0.0.1
```

Open `http://localhost:5173`. The UI is intentionally a not-connected state until OAuth and authorization are implemented.

**Optional PostgreSQL**: set `DATABASE_URL`, `AADOS_ENABLE_DATABASE=true`, and run `mix ecto.create` before starting the API. Database-backed mail storage/migrations are planned for the next milestone; Oban is only started when the database is enabled.

## Release and deployment

`bin/pull-latest.sh` only fast-forwards a clean working tree. `bin/push.sh` prompts for version level (Patch is default; No bump is option 5), commits and pushes without force, and checks existing tags before creating a release tag. Scripts do not supply or invent signing credentials, cluster settings, or secrets.

`bin/deploy-openshift.sh` requires configured images, `oc`, `helm`, an existing `aados-dev` or `aados-prod` namespace, and the `aados-api-secrets` Secret containing `secret_key_base`. It validates access and image settings before deploying. **No public Route is created in this release**: owner authentication is not yet present. See [OpenShift guide](docs/openshift.md).

`bin/build-ipa.sh` validates a configured macOS/Xcode build project, signing and export settings. The native iOS project is a future milestone; this script correctly stops if it has not been supplied.

## Security boundary

No email provider credentials or tokens are shipped or requested. No auth or OAuth is implemented yet, so **do not expose this bootstrap to the public internet**. The Helm chart uses ClusterIP services only. Provider OAuth scopes will be Gmail `gmail.readonly` and Microsoft Graph `Mail.Read`, with separate per-account grants and encrypted token storage after identity and session security are in place. No send/archive/delete capability is included.

See [Architecture](docs/architecture.md), [Roadmap](docs/roadmap.md), [Security](docs/security.md).
