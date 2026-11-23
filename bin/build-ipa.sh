#!/usr/bin/env bash
# Unsigned Flutter iOS IPA for AltStore-style installation, matching ajopsios.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
github_repo="${AADOS_GITHUB_REPO:-ssnanda/AadOS}"
release_tag="ios-latest"
publish=true

usage() {
  cat <<'USAGE'
Usage: ./bin/build-ipa.sh [--local] [--repo OWNER/REPO]

Builds the native Flutter AadOS app as an unsigned IPA, commits/pushes the root
altstore.json source, and uploads only the IPA to the rolling GitHub release.

  --local             Build and update altstore.json without touching GitHub
  --repo OWNER/REPO   Override the GitHub repository
  --help              Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local|--no-publish) publish=false; shift ;;
    --repo) github_repo="${2:-}"; [[ -n "$github_repo" ]] || { echo 'ERROR: --repo requires OWNER/REPO.' >&2; exit 1; }; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done
if [[ "$publish" == true ]]; then
  command -v git >/dev/null || { echo 'ERROR: git is required. Use --local to skip publishing.' >&2; exit 1; }
  command -v gh >/dev/null || { echo 'ERROR: GitHub CLI is required. Use --local to skip publishing.' >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "ERROR: GitHub CLI is not authenticated. Run 'gh auth login' or use --local." >&2; exit 1; }
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo 'Uncommitted release changes detected — running the AadOS bump/commit/push workflow first.'
    ./bin/bump.sh --if-dirty
  fi
fi
version="$(tr -d '[:space:]' < VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: invalid VERSION '$version'." >&2; exit 1; }
if [[ -n "${IOS_BUILD_NUMBER:-}" ]]; then
  build="$IOS_BUILD_NUMBER"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  build="$(git rev-list --count HEAD)"
else
  build=1
fi
[[ "$build" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: IOS_BUILD_NUMBER must be a positive integer (got '$build')." >&2; exit 1; }
if [[ "$(uname -s)" != Darwin ]]; then
  if [[ -n "${AADOS_IOS_WORKFLOW:-}" ]] && command -v gh >/dev/null; then
    gh workflow run "$AADOS_IOS_WORKFLOW" --ref "$(git branch --show-current)"
    echo 'Requested configured macOS GitHub Actions workflow. No IPA has been produced locally.'
    exit 0
  fi
  echo 'ERROR: iOS IPA creation requires macOS/Xcode. Configure AADOS_IOS_WORKFLOW and gh on this host, or run on a macOS runner.' >&2
  exit 1
fi
command -v flutter >/dev/null || { echo 'ERROR: Flutter is required to build the native mobile app.' >&2; exit 1; }
command -v ditto >/dev/null || { echo 'ERROR: macOS ditto is required.' >&2; exit 1; }
command -v zip >/dev/null || { echo 'ERROR: zip is required.' >&2; exit 1; }
output="${IOS_OUTPUT_DIR:-$PWD/build/ios/ipa}"
mkdir -p "$output"
log="$output/flutter-build.log"
trap 'echo "Build/package failed; see $log" >&2; tail -n 40 "$log" >&2 || true' ERR
echo 'Building native Flutter iPhoneOS app without code signing...'
(cd apps/mobile && flutter build ios --release --no-codesign --build-name "$version" --build-number "$build") >"$log" 2>&1
app="$PWD/apps/mobile/build/ios/iphoneos/Runner.app"
bundle="${IOS_BUNDLE_IDENTIFIER:-com.aadnanda.aados}"
[[ -d "$app" ]] || { echo "ERROR: Flutter build produced no Runner.app. Logs: $log" >&2; exit 1; }
package="$(mktemp -d "${TMPDIR:-/tmp}/aados-ipa.XXXXXX")"
mkdir -p "$package/Payload"
ditto "$app" "$package/Payload/AadOS.app"
ipa="$output/aados.ipa"
# Fail fast on an empty/stub bundle: a .app with no compiled binary or no
# CFBundleIdentifier is rejected by AltStore/SideLoader ("bundle ID differs").
plist="$package/Payload/AadOS.app/Info.plist"
app_bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null || true)"
app_exec="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist" 2>/dev/null || true)"
[[ "$app_bundle" == "$bundle" ]] || { echo "ERROR: built Info.plist CFBundleIdentifier '$app_bundle' != '$bundle'." >&2; exit 1; }
[[ -n "$app_exec" && -s "$package/Payload/AadOS.app/$app_exec" ]] || { echo "ERROR: built .app has no executable ('$app_exec'); no sources were compiled. Logs: $log" >&2; exit 1; }
if [[ -e "$ipa" ]]; then
  osascript -e "tell application \"Finder\" to delete POSIX file \"$ipa\"" >/dev/null
fi
(cd "$package" && zip -qry "$ipa" Payload)
[[ -s "$ipa" ]] || { echo "ERROR: packaging produced no IPA. Logs: $log" >&2; exit 1; }
osascript -e "tell application \"Finder\" to delete POSIX file \"$package\"" >/dev/null
trap - ERR

size="$(stat -f%z "$ipa")"
date="$(date +%Y-%m-%d)"
download_url="https://github.com/$github_repo/releases/download/$release_tag/$(basename "$ipa")"
cat > altstore.json <<JSON
{
  "name": "AadOS",
  "identifier": "com.aadnanda.aados.altstore",
  "sourceURL": "https://raw.githubusercontent.com/$github_repo/main/altstore.json",
  "apps": [
    {
      "name": "AadOS",
      "bundleIdentifier": "$bundle",
      "developerName": "AadNanda",
      "subtitle": "Your personal operating system",
      "localizedDescription": "AadOS provides secure access to your personal email, calendar, tasks, reminders, documents, and AI workspace.",
      "iconURL": "https://raw.githubusercontent.com/$github_repo/main/apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png",
      "tintColor": "6C4CF1",
      "category": "utilities",
      "screenshotURLs": [],
      "versions": [
        {
          "version": "$version",
          "buildVersion": "$build",
          "date": "$date",
          "localizedDescription": "AadOS $version build $build",
          "downloadURL": "$download_url",
          "size": $size,
          "minOSVersion": "15.0"
        }
      ]
    }
  ],
  "news": []
}
JSON
echo "AltStore manifest updated locally: $PWD/altstore.json"

if [[ "$publish" == true ]]; then
  branch="$(git symbolic-ref --quiet --short HEAD)" || { echo 'ERROR: detached HEAD.' >&2; exit 1; }
  git add altstore.json
  if ! git diff --cached --quiet; then
    git commit -m "AltStore manifest $version+$build [skip ci]"
    git push origin "HEAD:refs/heads/$branch"
    echo "GitHub source: https://raw.githubusercontent.com/$github_repo/$branch/altstore.json"
  else
    echo 'AltStore manifest unchanged; no manifest commit needed.'
  fi
  notes="AadOS iOS — version $version, build $build. Unsigned IPA for AltStore-style installation."
  sha="$(git rev-parse HEAD)"
  git tag -f "$release_tag" "$sha" >/dev/null
  git push -f origin "refs/tags/$release_tag"
  if gh release view "$release_tag" --repo "$github_repo" >/dev/null 2>&1; then
    gh release delete "$release_tag" --repo "$github_repo" --yes
  fi
  gh release create "$release_tag" "$ipa" --repo "$github_repo" --title 'AadOS — iOS (latest)' --notes "$notes" --latest
  echo "GitHub IPA: $download_url"
  echo 'Release assets: only aados.ipa (altstore.json is served from the repository root).'
fi

echo "Version: $version | build: $build | unsigned IPA: $ipa | log: $log"
