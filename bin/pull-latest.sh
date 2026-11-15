#!/usr/bin/env bash
# Fast-forward a clean local checkout without discarding work.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
command -v git >/dev/null || { echo 'ERROR: git is required.' >&2; exit 1; }
branch="$(git symbolic-ref --quiet --short HEAD)" || { echo 'ERROR: detached HEAD.' >&2; exit 1; }
before="$(git rev-parse --short HEAD)"
echo "AadOS | branch=$branch | before=$before"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'ERROR: local files changed. Commit or stash first; no files were overwritten.' >&2
  git status --short
  exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then echo 'ERROR: origin is not configured.' >&2; exit 1; fi
if ! git fetch --prune origin "$branch"; then echo 'ERROR: fetch failed; checkout unchanged.' >&2; exit 1; fi
if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  echo "ERROR: origin/$branch not found." >&2; exit 1
fi
if ! git merge --ff-only "origin/$branch"; then
  echo 'ERROR: divergent commits. No merge or overwrite was performed.' >&2; exit 1
fi
echo "AadOS | branch=$branch | after=$(git rev-parse --short HEAD) | clean"
