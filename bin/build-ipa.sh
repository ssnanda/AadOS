#!/usr/bin/env bash
# Signed native iOS build. Requires a configured Xcode project and Apple signing.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Local changes detected; running bin/bump.sh first.'
  ./bin/bump.sh --if-dirty || { echo 'ERROR: push failed; build cancelled.' >&2; exit 1; }
fi
version="$(cat VERSION)"
if [[ "$(uname -s)" != Darwin ]]; then
  if [[ -n "${AADOS_IOS_WORKFLOW:-}" ]] && command -v gh >/dev/null; then
    gh workflow run "$AADOS_IOS_WORKFLOW" --ref "$(git branch --show-current)"
    echo 'Requested configured macOS GitHub Actions workflow. No IPA has been produced locally.'
    exit 0
  fi
  echo 'ERROR: signed IPA requires macOS/Xcode. Configure AADOS_IOS_WORKFLOW and gh on this host, or run on a macOS runner.' >&2
  exit 1
fi
command -v xcodebuild >/dev/null || { echo 'ERROR: Xcode is not installed/configured.' >&2; exit 1; }
xcodebuild -version
[[ -n "${IOS_SCHEME:-}" ]] || { echo 'ERROR: IOS_SCHEME not configured.' >&2; exit 1; }
[[ -f "${IOS_EXPORT_OPTIONS_PLIST:-/nonexistent}" ]] || { echo 'ERROR: IOS_EXPORT_OPTIONS_PLIST not found.' >&2; exit 1; }
if [[ -n "${IOS_WORKSPACE:-}" && -d "$IOS_WORKSPACE" ]]; then
  target=(-workspace "$IOS_WORKSPACE")
elif [[ -n "${IOS_PROJECT:-}" && -d "$IOS_PROJECT" ]]; then
  target=(-project "$IOS_PROJECT")
else
  echo 'ERROR: IOS_WORKSPACE or IOS_PROJECT required; native iOS app not yet included.' >&2; exit 1
fi
if ! security find-identity -v -p codesigning | grep -q 'Apple Distribution'; then
  echo 'ERROR: no Apple Distribution signing identity in keychain.' >&2; exit 1
fi
settings="$(xcodebuild "${target[@]}" -scheme "$IOS_SCHEME" -configuration Release -showBuildSettings 2>/dev/null)" || { echo 'ERROR: cannot inspect Xcode settings.' >&2; exit 1; }
team="$(printf '%s\n' "$settings" | sed -n 's/^ *DEVELOPMENT_TEAM = //p' | head -n 1)"
build="$(printf '%s\n' "$settings" | sed -n 's/^ *CURRENT_PROJECT_VERSION = //p' | head -n 1)"
[[ -n "$team" && -n "$build" ]] || { echo 'ERROR: missing development team/build number.' >&2; exit 1; }
output="${IOS_OUTPUT_DIR:-$PWD/build/ios/$version-$build}"
mkdir -p "$output"
archive="$output/AadOS.xcarchive"
log="$output/xcodebuild.log"
trap 'echo "Build/export failed; see $log" >&2; tail -n 40 "$log" >&2 || true' ERR
xcodebuild "${target[@]}" -scheme "$IOS_SCHEME" -configuration Release -destination 'generic/platform=iOS' -archivePath "$archive" archive > "$log" 2>&1
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$IOS_EXPORT_OPTIONS_PLIST" -exportPath "$output" >> "$log" 2>&1
ipa="$(find "$output" -maxdepth 1 -name '*.ipa' -print -quit)"
[[ -n "$ipa" ]] || { echo "ERROR: export produced no IPA. Logs: $log" >&2; exit 1; }
echo "Version: $version | build: $build | team: $team | IPA: $ipa | log: $log"
