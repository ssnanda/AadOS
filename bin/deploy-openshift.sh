#!/usr/bin/env bash
# Compatibility alias for the previous deployment command.
set -Eeuo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oc-deploy.sh" "$@"
