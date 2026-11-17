#!/usr/bin/env bash
# AJOPS-style local Docker Compose development, private to 127.0.0.1.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMMAND=rebuild
RESET_USER=false
CONFIG_KEY=''
for arg in "$@"; do
  case "$arg" in
    --reset-user) RESET_USER=true ;;
    *) if [[ "$COMMAND" == config ]]; then CONFIG_KEY="$arg"; else COMMAND="$arg"; fi ;;
  esac
done
if [[ "$COMMAND" == bump ]]; then exec "$ROOT/bin/bump.sh"; fi
if [[ "$COMMAND" == help || "$COMMAND" == --help || "$COMMAND" == -h ]]; then
  echo 'Usage: bin/dev-local.sh [rebuild|refresh|stop|logs|shell|test|bump] [--reset-user]'
  echo '  rebuild  Build and start the local stack from the working tree. Never commits, bumps or pushes.'
  echo '  test     Run all checks locally: web check + Node tests, then API tests against a throwaway Postgres (Docker).'
  echo '  config KEY   Securely set an optional setting (AADOS_AJMCP_URL/TOKEN, AADOS_S3_*); config --list shows which are set'
  echo '  bump     The only git action: commit/version/tag/push via bump.sh ([skip ci], no GitHub Actions).'
  echo '  --reset-user  Generate a new username and password, invalidating all sessions'
  echo 'Local web: http://127.0.0.1:3100 | API: http://127.0.0.1:4000 (override with AADOS_WEB_PORT / AADOS_API_PORT)'
  exit 0
fi
[[ "$COMMAND" == rebuild || "$COMMAND" == refresh || "$COMMAND" == stop || "$COMMAND" == logs || "$COMMAND" == shell || "$COMMAND" == test || "$COMMAND" == config ]] || {
  echo "ERROR: Unknown command $COMMAND" >&2; exit 2;
}
command -v docker >/dev/null 2>&1 || { echo 'ERROR: Docker CLI missing.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose plugin missing.' >&2; exit 1; }
# This script never commits, bumps, tags or pushes. Releases go through bin/bump.sh (or `bin/dev-local.sh bump`) only.
if [[ "$COMMAND" == rebuild && -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Note: building uncommitted local changes (nothing is committed or pushed; run bin/bump.sh to release).'
fi
if [[ "$COMMAND" == test ]]; then
  # Same checks CI runs, but on this machine: no GitHub Actions involved.
  # Compose interpolates every service's required variables; these placeholders are never used by the test services.
  export SECRET_KEY_BASE=test-only AADOS_USER=test AADOS_PASSWORD_HASH=test AADOS_SESSION_SECRET=test POSTGRES_PASSWORD=test AADOS_CREDENTIAL_ENCRYPTION_KEY=test AADOS_INTERNAL_API_TOKEN=test
  status=0
  docker compose --profile test up -d --wait testdb
  (cd "$ROOT/apps/web" && npm ci --no-audit --no-fund && npm run check && AADOS_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/aados_test npm test) || status=$?
  [[ "$status" == 0 ]] || { docker compose --profile test stop testdb >/dev/null 2>&1 || true; exit "$status"; }
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
if [[ "$COMMAND" == config ]]; then
  # Optional integration secrets live only in the local config volume (never in the repo or shell history).
  ALLOWED='AADOS_AJMCP_URL AADOS_AJMCP_TOKEN AADOS_S3_ENDPOINT AADOS_S3_BUCKET AADOS_S3_REGION AADOS_S3_ACCESS_KEY AADOS_S3_SECRET_KEY AADOS_S3_FORCE_PATH_STYLE AADOS_S3_PREFIX'
  if [[ -z "$CONFIG_KEY" || "$CONFIG_KEY" == --list ]]; then
    for k in $ALLOWED; do if grep -q "^$k=" <<< "$CONFIG"; then echo "  $k: set"; else echo "  $k: -"; fi; done
    echo 'Set one with: bin/dev-local.sh config <KEY>  (then bin/dev-local.sh refresh)'; exit 0
  fi
  [[ " $ALLOWED " == *" $CONFIG_KEY "* ]] || { echo "ERROR: $CONFIG_KEY is not a supported setting. Allowed: $ALLOWED" >&2; exit 2; }
  printf 'Value for %s (input hidden, empty = remove): ' "$CONFIG_KEY"; read -rs VALUE; echo
  [[ "$VALUE" != *"'"* ]] || { echo 'ERROR: values cannot contain single quotes.' >&2; exit 2; }
  CONFIG="$(printf '%s\n' "$CONFIG" | grep -v "^$CONFIG_KEY=" || true)"
  if [[ -n "$VALUE" ]]; then CONFIG="$(printf "%s\n%s='%s'" "$CONFIG" "$CONFIG_KEY" "$VALUE")"; fi
  printf '%s\n' "$CONFIG" | sed '/^$/d' | config_write
  if [[ -n "$VALUE" ]]; then echo "$CONFIG_KEY saved (value not shown)."; else echo "$CONFIG_KEY removed."; fi
  echo 'Apply with: bin/dev-local.sh refresh'; exit 0
fi
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
# PostgreSQL password, credential-encryption key (base64, 32 bytes) and web->API service token.
# They live only in the config volume. Losing the credential key makes stored OAuth tokens unreadable (reconnect accounts).
if ! grep -q '^POSTGRES_PASSWORD=' <<< "$CONFIG"; then
  CONFIG="$(printf '%s\nPOSTGRES_PASSWORD=%s' "$CONFIG" "$(openssl rand -hex 24)")"
  CONFIG_CHANGED=true
fi
if ! grep -q '^AADOS_CREDENTIAL_ENCRYPTION_KEY=' <<< "$CONFIG"; then
  CONFIG="$(printf "%s\nAADOS_CREDENTIAL_ENCRYPTION_KEY='%s'" "$CONFIG" "$(openssl rand -base64 32)")"
  CONFIG_CHANGED=true
fi
if ! grep -q '^AADOS_INTERNAL_API_TOKEN=' <<< "$CONFIG"; then
  CONFIG="$(printf '%s\nAADOS_INTERNAL_API_TOKEN=%s' "$CONFIG" "$(openssl rand -hex 32)")"
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
[[ ${#SECRET_KEY_BASE} -ge 64 ]] || { echo 'ERROR: SECRET_KEY_BASE must contain at least 64 characters.' >&2; exit 1; }
# Printed last, after all build/compose output, so it is the final thing on screen.
summary() {
  echo ''
  echo "AadOS v$(tr -d '[:space:]' < "$ROOT/VERSION") is running locally."
  echo "  URL:      http://127.0.0.1:${AADOS_WEB_PORT:-3100}"
  echo "  Username: $AADOS_USER"
  if [[ -n "${NEW_LOGIN_PASSWORD:-}" ]]; then echo "  Password: $NEW_LOGIN_PASSWORD   (shown once - save it now)"; fi
  echo "  Reset:    ./bin/dev-local.sh --reset-user"
}
case "$COMMAND" in
  rebuild) docker compose up -d --build --remove-orphans; summary ;;
  refresh) docker compose up -d --no-build; summary ;;
  stop) docker compose down ;;
  logs) docker compose logs -f ;;
  shell) docker compose exec web sh ;;
esac
