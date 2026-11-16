#!/usr/bin/env bash
# Compatibility alias for the original AadOS command.
set -Eeuo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bump.sh" "$@"
