#!/usr/bin/env bash
# AadOS — AJOPS-style binary builds deployed with oc; Helm is not required.
# This bootstrap intentionally has no public Route or Ingress.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail 'git CLI missing.'
command -v oc >/dev/null 2>&1 || fail 'oc CLI missing.'

# Keep the deployed source in GitHub first, as with AJOPS.
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Local changes found; running bin/bump.sh before deployment.'
  "$ROOT/bin/bump.sh" --if-dirty || fail 'Git push failed; deployment cancelled.'
fi

AADOS_ENV="${AADOS_ENV:-dev}"
[[ "$AADOS_ENV" == dev || "$AADOS_ENV" == prod ]] || fail 'AADOS_ENV must be dev or prod.'
NAMESPACE="${AADOS_NAMESPACE:-${OPENSHIFT_PROJECT:-aados-$AADOS_ENV}}"
APP_NAME="${AADOS_APP_NAME:-aados}"
[[ "$NAMESPACE" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ && ${#NAMESPACE} -le 63 ]] || fail "Invalid OpenShift namespace: $NAMESPACE"
[[ "$APP_NAME" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ && ${#APP_NAME} -le 40 ]] || fail "Invalid OpenShift app name: $APP_NAME"

oc whoami >/dev/null 2>&1 || fail 'OpenShift session expired. Run oc login on your Mac.'
CLUSTER="$(oc config current-context)"
USER="$(oc whoami)"
VERSION="$(tr -d '[:space:]' < VERSION)"

if [[ "$AADOS_ENV" == prod ]]; then
  echo 'WARNING: AadOS does not yet have user authentication or email OAuth. Never expose this release publicly.'
  printf 'Deploy version %s to PRODUCTION namespace %s on cluster %s? Type DEPLOY-PROD: ' "$VERSION" "$NAMESPACE" "$CLUSTER"
  read -r CONFIRMATION
  [[ "$CONFIRMATION" == DEPLOY-PROD ]] || fail 'Production deployment cancelled.'
fi

if ! oc get namespace "$NAMESPACE" >/dev/null 2>&1; then
  if [[ "$AADOS_ENV" == prod ]]; then
    fail "Production namespace $NAMESPACE does not exist. Create it explicitly first."
  fi
  echo "Creating development project $NAMESPACE..."
  oc new-project "$NAMESPACE" --display-name='AadOS Development' >/dev/null || fail "Cannot create namespace $NAMESPACE."
fi

oc auth can-i create buildconfigs.build.openshift.io -n "$NAMESPACE" | grep -qx yes || fail 'Missing BuildConfig creation permission.'
oc auth can-i create deployments.apps -n "$NAMESPACE" | grep -qx yes || fail 'Missing Deployment creation permission.'

# Only development creates a secret automatically, never production.
if ! oc get secret aados-api-secrets -n "$NAMESPACE" >/dev/null 2>&1; then
  [[ "$AADOS_ENV" == dev ]] || fail "Create secret aados-api-secrets (key secret_key_base) in $NAMESPACE first."
  command -v openssl >/dev/null 2>&1 || fail 'openssl is required to generate the development Phoenix secret.'
  echo 'Creating a new development-only Phoenix secret in OpenShift (not printed or committed).'
  openssl rand -hex 48 | tr -d '\n' | oc create secret generic aados-api-secrets --from-file=secret_key_base=/dev/stdin -n "$NAMESPACE" >/dev/null
fi
[[ -n "$(oc get secret aados-api-secrets -n "$NAMESPACE" -o jsonpath='{.data.secret_key_base}')" ]] || fail 'OpenShift secret aados-api-secrets lacks key secret_key_base.'

LOGDIR="${AADOS_DEPLOY_LOG_DIR:-$ROOT/build/deploy}"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$AADOS_ENV-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1
on_error() {
  local status=$?
  trap - ERR
  echo "Deployment failed (exit $status). Version $VERSION NOT verified as deployed. Log: $LOG" >&2
  oc get pods -n "$NAMESPACE" -l app.kubernetes.io/part-of=aados -o wide >&2 || true
  oc get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -n 15 >&2 || true
  exit "$status"
}
trap on_error ERR

echo "AadOS v$VERSION | cluster=$CLUSTER | oc user=$USER | namespace=$NAMESPACE | environment=$AADOS_ENV"
echo 'No Helm dependency. Using OpenShift ImageStreams and binary Docker BuildConfigs.'

# Build images from local source; OpenShift's internal registry stores them.
oc process -f openshift/build.yaml -p "APP_NAME=$APP_NAME" -p "NAMESPACE=$NAMESPACE" | oc apply -n "$NAMESPACE" -f -
for component in api web; do
  echo "Building $APP_NAME-$component in OpenShift from apps/$component..."
  oc start-build "$APP_NAME-$component" -n "$NAMESPACE" \
    --from-dir="apps/$component" \
    --exclude='(^|/)(\.git|_build|deps|node_modules|\.svelte-kit|build)(/|$)' \
    --follow --wait
  oc get istag "$APP_NAME-$component:latest" -n "$NAMESPACE" >/dev/null || fail "ImageStreamTag for $component missing after build."
done

# Apply private ClusterIP services/deployments only after both images are built.
# Existing deployments need a restart to pull the updated :latest ImageStreamTag.
EXISTING_API=false
EXISTING_WEB=false
oc get deployment "$APP_NAME-api" -n "$NAMESPACE" >/dev/null 2>&1 && EXISTING_API=true
oc get deployment "$APP_NAME-web" -n "$NAMESPACE" >/dev/null 2>&1 && EXISTING_WEB=true
oc process -f openshift/app.yaml -p "APP_NAME=$APP_NAME" -p "NAMESPACE=$NAMESPACE" | oc apply -n "$NAMESPACE" -f -
if [[ "$EXISTING_API" == true ]]; then oc rollout restart "deployment/$APP_NAME-api" -n "$NAMESPACE"; fi
if [[ "$EXISTING_WEB" == true ]]; then oc rollout restart "deployment/$APP_NAME-web" -n "$NAMESPACE"; fi

for component in api web; do
  echo "Verifying rollout for $APP_NAME-$component..."
  if ! oc rollout status "deployment/$APP_NAME-$component" -n "$NAMESPACE" --timeout=300s; then
    oc logs "deployment/$APP_NAME-$component" -n "$NAMESPACE" --tail=60 || true
    fail "Rollout failed for $APP_NAME-$component; inspect log $LOG"
  fi
done

oc get deployment "$APP_NAME-api" "$APP_NAME-web" -n "$NAMESPACE"
echo "Deployed AadOS v$VERSION successfully."
echo 'Public URL: none (private ClusterIP services, no Route).'
echo "Local access: oc port-forward -n $NAMESPACE svc/$APP_NAME-web 3000:3000"
echo 'Then open http://localhost:3000'
echo "Log: $LOG"
