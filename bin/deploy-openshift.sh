#!/usr/bin/env bash
# Deploy only pre-built, configured images; production requires confirmation.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Local changes detected; running bin/push.sh first.'
  ./bin/push.sh || { echo 'ERROR: push failed; deployment cancelled.' >&2; exit 1; }
fi
command -v oc >/dev/null || { echo 'ERROR: oc CLI missing.' >&2; exit 1; }
command -v helm >/dev/null || { echo 'ERROR: helm CLI missing.' >&2; exit 1; }
environment="${AADOS_ENV:-dev}"
[[ "$environment" == dev || "$environment" == prod ]] || { echo 'ERROR: AADOS_ENV must be dev or prod.' >&2; exit 1; }
namespace="${AADOS_NAMESPACE:-aados-$environment}"
release="${AADOS_RELEASE:-aados}"
[[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]] || { echo 'ERROR: API_IMAGE and WEB_IMAGE must specify existing registry image references.' >&2; exit 1; }
if [[ "$environment" == prod ]]; then
  printf 'Deploy version %s to PRODUCTION namespace %s on cluster %s? Type DEPLOY-PROD: ' "$(cat VERSION)" "$namespace" "$(oc config current-context)"
  read -r confirmation
  [[ "$confirmation" == DEPLOY-PROD ]] || { echo 'Production deployment cancelled.' >&2; exit 1; }
fi
oc whoami >/dev/null || { echo 'ERROR: cannot authenticate to OpenShift.' >&2; exit 1; }
cluster="$(oc config current-context)"
oc get namespace "$namespace" >/dev/null || { echo "ERROR: namespace $namespace unavailable." >&2; exit 1; }
oc auth can-i create deployments -n "$namespace" | grep -qx yes || { echo 'ERROR: cannot deploy in target namespace.' >&2; exit 1; }
oc get secret aados-api-secrets -n "$namespace" >/dev/null || { echo 'ERROR: aados-api-secrets missing.' >&2; exit 1; }
values="charts/aados/values-$environment.yaml"
logdir="${AADOS_DEPLOY_LOG_DIR:-$PWD/build/deploy}"
mkdir -p "$logdir"
log="$logdir/$environment-$(date -u +%Y%m%dT%H%M%SZ).log"
if ! helm upgrade --install "$release" charts/aados -f "$values" \
  --namespace "$namespace" --wait --timeout 5m \
  --set-string "api.image=$API_IMAGE" --set-string "web.image=$WEB_IMAGE" > "$log" 2>&1; then
  cat "$log" >&2
  oc get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 20 >&2 || true
  exit 1
fi
for component in api web; do
  if ! oc rollout status "deployment/$release-$component" -n "$namespace" --timeout=180s >> "$log" 2>&1; then
    oc logs "deployment/$release-$component" -n "$namespace" --tail=60 >> "$log" 2>&1 || true
    cat "$log" >&2
    exit 1
  fi
done
oc get deployment "$release-api" "$release-web" -n "$namespace"
echo "Deployed AadOS $(cat VERSION) | cluster=$cluster | namespace=$namespace | internal service=$release-web:3000 | public URL=none | log=$log"
