#!/usr/bin/env bash
# AadOS canonical AJOPS-style bump/commit/push (patch default; option 5 no bump).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
command -v git >/dev/null || { echo 'ERROR: git is required.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'ERROR: python3 is required.' >&2; exit 1; }
if [[ "${1:-}" == --if-dirty ]]; then
  shift
  if [[ -z "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo 'No local changes; skipping version bump.'
    exit 0
  fi
fi
[[ $# -eq 0 ]] || { echo 'Usage: bin/bump.sh [--if-dirty]' >&2; exit 2; }
branch="$(git symbolic-ref --quiet --short HEAD)" || { echo 'ERROR: detached HEAD.' >&2; exit 1; }
[[ -f VERSION ]] || { echo 'ERROR: root VERSION missing.' >&2; exit 1; }
[[ -n "$(git status --porcelain --untracked-files=normal)" ]] || { echo "No local changes on $branch; no commit or bump needed."; exit 0; }
git remote get-url origin >/dev/null 2>&1 || { echo 'ERROR: origin missing.' >&2; exit 1; }
git fetch --tags origin "$branch" || { echo 'ERROR: cannot fetch remote. Nothing was committed.' >&2; exit 1; }
if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git merge-base --is-ancestor "origin/$branch" HEAD || { echo "ERROR: branch is behind/diverged from origin/$branch. Pull/reconcile first." >&2; exit 1; }
fi
old="$(tr -d '[:space:]' < VERSION)"
[[ "$old" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "ERROR: invalid VERSION '$old'." >&2; exit 1; }
printf 'Version: %s\n  1. Minor\n  2. Patch (default)\n  3. Major\n  4. Custom\n  5. No bump (commit/push only)\nChoice [2]: ' "$old"
read -r choice || choice=2
choice="${choice:-2}"
IFS=. read -r major minor patch <<< "$old"
case "$choice" in
  1) new="$major.$((minor+1)).0" ;;
  2) new="$major.$minor.$((patch+1))" ;;
  3) new="$((major+1)).0.0" ;;
  4)
    read -r -p 'New version (MAJOR.MINOR.PATCH): ' new
    [[ "$new" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'ERROR: invalid SemVer.' >&2; exit 1; }
    python3 - "$old" "$new" <<'PY'
import sys
before, after = [tuple(map(int, v.split('.'))) for v in sys.argv[1:]]
if after <= before:
    raise SystemExit('ERROR: custom version must increase.')
PY
    ;;
  5) new="$old" ;;
  *) echo 'ERROR: choose 1 through 5.' >&2; exit 1 ;;
esac
if [[ "$choice" != 5 ]]; then
  tag="v$new"
  [[ -z "$(git tag --list "$tag")" ]] || { echo "ERROR: tag $tag already exists." >&2; exit 1; }
  if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    echo "ERROR: remote tag $tag already exists." >&2; exit 1
  fi
  python3 - "$old" "$new" <<'PY'
from pathlib import Path
import json, sys
before, after = sys.argv[1:]
Path('VERSION').write_text(after + '\n')
package = Path('apps/web/package.json')
if package.exists():
    data = json.loads(package.read_text())
    if data.get('version') != before:
        raise SystemExit('ERROR: web version differs from VERSION')
    data['version'] = after
    package.write_text(json.dumps(data, indent=2) + '\n')
mix = Path('apps/api/mix.exs')
if mix.exists():
    text = mix.read_text()
    old = 'version: "' + before + '"'
    if text.count(old) != 1:
        raise SystemExit('ERROR: mix.exs version differs from VERSION')
    mix.write_text(text.replace(old, 'version: "' + after + '"', 1))
health = Path('apps/api/lib/aados/api/controllers/health_controller.ex')
if health.exists():
    value = health.read_text()
    old = 'version: "' + before + '"'
    if value.count(old) != 1:
        raise SystemExit('ERROR: health version differs from VERSION')
    health.write_text(value.replace(old, 'version: "' + after + '"', 1))
chart = Path('charts/aados/Chart.yaml')
if chart.exists():
    value = chart.read_text()
    for key in ('version', 'appVersion'):
        import re
        pat = re.compile(r'(?m)^' + key + r':\s*["\']?' + re.escape(before) + r'["\']?\s*$')
        if len(pat.findall(value)) != 1:
            raise SystemExit('ERROR: chart ' + key + ' differs from VERSION')
        value = pat.sub(key + ': "' + after + '"', value)
    chart.write_text(value)
PY
fi
git add -A
if git diff --cached --quiet; then echo 'No staged changes; nothing to push.'; exit 0; fi
# Guard against accidentally staging common credential filenames.
if git diff --cached --name-only | grep -E '(^|/)(\.env($|\.[^/]+$)|id_rsa|id_ed25519|credentials\.json|service-account\.json|.*\.p8$|.*\.pem$)' | grep -vE '(\.env\.example$|\.env\.[^/]+\.example$)' ; then
  echo 'ERROR: potentially sensitive staged filename. Unstage before retry.' >&2
  exit 1
fi
message="chore: update AadOS"
if [[ "$choice" != 5 ]]; then message="chore(release): v$new"; fi
git commit -m "$message"
if [[ "$choice" != 5 ]]; then
  git tag "v$new"
  git push --atomic origin "HEAD:refs/heads/$branch" "refs/tags/v$new"
else
  git push origin "HEAD:refs/heads/$branch"
fi
echo "Pushed $branch $(git rev-parse --short HEAD) | version $old -> $new"
