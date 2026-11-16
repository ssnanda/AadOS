#!/usr/bin/env bash
# AJOPS-style local Docker Compose development, private to 127.0.0.1.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMMAND=rebuild
RESET_USER=false
for arg in "$@"; do
  case "$arg" in
    --reset-user) RESET_USER=true ;;
    *) COMMAND="$arg" ;;
  esac
done
if [[ "$COMMAND" == bump ]]; then AADOS_SKIP_CI=1 exec "$ROOT/bin/bump.sh"; fi
if [[ "$COMMAND" == help || "$COMMAND" == --help || "$COMMAND" == -h ]]; then
  echo 'Usage: bin/dev-local.sh [rebuild|refresh|stop|logs|shell|test|bump] [--reset-user]'
  echo '  rebuild  Build and start the local stack. Never touches git (no commit, bump, push or CI).'
  echo '  test     Run all checks locally: web check + Node tests, then API tests against a throwaway Postgres (Docker).'
  echo '  bump     Explicit commit/version/push via bump.sh (adds [skip ci]); the only command that uses git.'
  echo '  --reset-user  Generate a new username and password, invalidating all sessions'
  echo 'Local web: http://127.0.0.1:3100 | API: http://127.0.0.1:4000 (override with AADOS_WEB_PORT / AADOS_API_PORT)'
  exit 0
fi
[[ "$COMMAND" == rebuild || "$COMMAND" == refresh || "$COMMAND" == stop || "$COMMAND" == logs || "$COMMAND" == shell || "$COMMAND" == test ]] || {
  echo "ERROR: Unknown command $COMMAND" >&2; exit 2;
}
command -v docker >/dev/null 2>&1 || { echo 'ERROR: Docker CLI missing.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose plugin missing.' >&2; exit 1; }
# Local runs never commit, bump or push. Use `bin/dev-local.sh bump` (or bin/bump.sh) when you want that.
if [[ "$COMMAND" == test ]]; then
  # Same checks CI runs, but on this machine: no GitHub Actions involved.
  (cd "$ROOT/apps/web" && npm ci --no-audit --no-fund && npm run check && npm test)
  # Compose interpolates every service's required variables; these placeholders are never used by the test services.
  export SECRET_KEY_BASE=test-only AADOS_USER=test AADOS_PASSWORD_HASH=test AADOS_SESSION_SECRET=test
  status=0
  docker compose --profile test run --rm apitest || status=$?
  docker compose --profile test stop testdb >/dev/null 2>&1 || true
  exit "$status"
fi
# Local secrets live in a Docker volume (like oc-deploy.sh keeps them in the cluster),
# never in the repo. The session secret also encrypts the saved mail state.
CONFIG_VOLUME=aados-local-config
config_read() { docker run --rm -v "$CONFIG_VOLUME:/c:ro" node:22-alpine sh -c 'cat /c/env 2>/dev/null || true'; }
config_write() { docker run --rm -i -v "$CONFIG_VOLUME:/c" node:22-alpine sh -c 'umask 077; cat > /c/env'; }
CONFIG="$(config_read)"
if [[ "$RESET_USER" == true ]]; then
  # New random username and password; invalidates all sessions (they are signed with the
  # password hash). AADOS_SESSION_SECRET is kept: it also encrypts the saved mail state.
  CONFIG="$(printf '%s\n' "$CONFIG" | grep -vE '^(AADOS_USER|AADOS_PASSWORD_HASH)=' || true)"
  CONFIG_CHANGED=true
fi
CONFIG_CHANGED="${CONFIG_CHANGED:-false}"
command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl required to generate local secrets.' >&2; exit 1; }
if ! grep -q '^SECRET_KEY_BASE=' <<< "$CONFIG"; then
  CONFIG="$(printf '%s\nSECRET_KEY_BASE=%s' "$CONFIG" "$(openssl rand -hex 48)")"
  CONFIG_CHANGED=true
fi
if ! grep -q '^AADOS_SESSION_SECRET=' <<< "$CONFIG"; then
  CONFIG="$(printf "%s\nAADOS_SESSION_SECRET='%s'" "$CONFIG" "$(openssl rand -hex 48)")"
  CONFIG_CHANGED=true
fi
if ! grep -q '^AADOS_PASSWORD_HASH=' <<< "$CONFIG"; then
  command -v node >/dev/null 2>&1 || { echo 'ERROR: node required to generate a local login.' >&2; exit 1; }
  NEW_LOGIN_PASSWORD="$(node --input-type=module -e "import { generatePassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(generatePassword())")"
  LOCAL_HASH="$(AADOS_PASSWORD="$NEW_LOGIN_PASSWORD" node --input-type=module -e "import { hashPassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(await hashPassword(process.env.AADOS_PASSWORD))")"
  # Single quotes: the scrypt hash contains '$'.
  CONFIG="$(printf "%s\nAADOS_USER='%s'\nAADOS_PASSWORD_HASH='%s'" "$CONFIG" "u-$(openssl rand -hex 6)" "$LOCAL_HASH")"
  CONFIG_CHANGED=true
fi
if [[ "$CONFIG_CHANGED" == true ]]; then printf '%s\n' "$CONFIG" | sed '/^$/d' | config_write; fi
set -a
eval "$CONFIG"
set +a
echo "Local login: username $AADOS_USER"
if [[ -n "${NEW_LOGIN_PASSWORD:-}" ]]; then echo "              password $NEW_LOGIN_PASSWORD   (shown once - save it now)"; fi
[[ ${#SECRET_KEY_BASE} -ge 64 ]] || { echo 'ERROR: SECRET_KEY_BASE must contain at least 64 characters.' >&2; exit 1; }
case "$COMMAND" in
  rebuild)
    docker compose up -d --build --remove-orphans
    echo "AadOS local web: http://127.0.0.1:${AADOS_WEB_PORT:-3100}"
    ;;
  refresh) docker compose up -d --no-build ;;
  stop) docker compose down ;;
  logs) docker compose logs -f ;;
  shell) docker compose exec web sh ;;
esac
