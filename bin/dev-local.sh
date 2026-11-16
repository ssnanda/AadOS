#!/usr/bin/env bash
# AJOPS-style local Docker Compose development, private to 127.0.0.1.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMMAND="${1:-rebuild}"
if [[ "$COMMAND" == bump ]]; then exec "$ROOT/bin/bump.sh"; fi
if [[ "$COMMAND" == help || "$COMMAND" == --help || "$COMMAND" == -h ]]; then
  echo 'Usage: bin/dev-local.sh [rebuild|refresh|stop|logs|shell|bump]'
  echo 'Local web: http://127.0.0.1:3000 | API: http://127.0.0.1:4000 (override with AADOS_WEB_PORT / AADOS_API_PORT)'
  exit 0
fi
[[ "$COMMAND" == rebuild || "$COMMAND" == refresh || "$COMMAND" == stop || "$COMMAND" == logs || "$COMMAND" == shell ]] || {
  echo "ERROR: Unknown command $COMMAND" >&2; exit 2;
}
command -v docker >/dev/null 2>&1 || { echo 'ERROR: Docker CLI missing.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose plugin missing.' >&2; exit 1; }
# AADOS_SKIP_BUMP=1 skips the commit/push step (for testing uncommitted work).
if [[ "$COMMAND" == rebuild && "${AADOS_SKIP_BUMP:-}" != 1 && -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  "$ROOT/bin/bump.sh" --if-dirty
fi
if [[ ! -f .env.local ]]; then
  command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl required to generate a local Phoenix secret.' >&2; exit 1; }
  umask 077
  printf 'SECRET_KEY_BASE=%s\n' "$(openssl rand -hex 48)" > .env.local
  echo 'Created private .env.local with a development-only Phoenix secret.'
fi
# The web app needs a login and session secret; generate a local-only set once.
if ! grep -q '^AADOS_PASSWORD_HASH=' .env.local; then
  command -v node >/dev/null 2>&1 || { echo 'ERROR: node required to generate a local login.' >&2; exit 1; }
  command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl required to generate a local session secret.' >&2; exit 1; }
  LOCAL_PASSWORD="$(node --input-type=module -e "import { generatePassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(generatePassword())")"
  LOCAL_HASH="$(AADOS_PASSWORD="$LOCAL_PASSWORD" node --input-type=module -e "import { hashPassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(await hashPassword(process.env.AADOS_PASSWORD))")"
  umask 077
  # Single quotes: the scrypt hash contains '$'.
  printf "AADOS_USER='local'\nAADOS_PASSWORD_HASH='%s'\nAADOS_SESSION_SECRET='%s'\n" "$LOCAL_HASH" "$(openssl rand -hex 48)" >> .env.local
  echo "Local login created: username 'local', password $LOCAL_PASSWORD (shown once; the hash is in .env.local)"
fi
# This is a developer-maintained local file; never print, upload, or commit it.
set -a
# shellcheck disable=SC1091
source .env.local
set +a
[[ ${#SECRET_KEY_BASE} -ge 64 ]] || { echo 'ERROR: .env.local SECRET_KEY_BASE must contain at least 64 characters.' >&2; exit 1; }
case "$COMMAND" in
  rebuild)
    docker compose up -d --build --remove-orphans
    echo "AadOS local web: http://127.0.0.1:${AADOS_WEB_PORT:-3000}"
    ;;
  refresh) docker compose up -d --no-build ;;
  stop) docker compose down ;;
  logs) docker compose logs -f ;;
  shell) docker compose exec web sh ;;
esac
