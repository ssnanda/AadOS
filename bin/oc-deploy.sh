#!/usr/bin/env bash
# AadOS — AJOPS-style binary builds deployed with oc; Helm is not required.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
AadOS OpenShift deployment:
  ./bin/oc-deploy.sh [--reset-user]

  --reset-user  Generate a new username and password, invalidating all sessions
USAGE
}

RESET_USER=false
for arg in "$@"; do
  case "$arg" in
    --reset-user) RESET_USER=true ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

for binary in git node oc openssl; do
  command -v "$binary" >/dev/null 2>&1 || fail "$binary CLI missing."
done

# Keep the deployed source in GitHub first, as with AJOPS.
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo 'Local changes found; running bin/bump.sh before deployment.'
  "$ROOT/bin/bump.sh" --if-dirty  # bump.sh adds [skip ci]: no GitHub Actions run || fail 'Git push failed; deployment cancelled.'
fi

AADOS_ENV="${AADOS_ENV:-dev}"
[[ "$AADOS_ENV" == dev || "$AADOS_ENV" == prod ]] || fail 'AADOS_ENV must be dev or prod.'
NAMESPACE="${AADOS_NAMESPACE:-${OPENSHIFT_PROJECT:-aados}}"
APP_NAME="${AADOS_APP_NAME:-aados}"
HOSTNAME="${AADOS_HOST:-os.aadnanda.com}"
ISSUER="${CERT_MANAGER_CLUSTER_ISSUER:-letsencrypt-prod}"
[[ "$NAMESPACE" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ && ${#NAMESPACE} -le 63 ]] || fail "Invalid OpenShift namespace: $NAMESPACE"
[[ "$APP_NAME" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ && ${#APP_NAME} -le 40 ]] || fail "Invalid OpenShift app name: $APP_NAME"
[[ "$HOSTNAME" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$HOSTNAME" == *.* && ${#HOSTNAME} -le 253 ]] || fail "Invalid AADOS_HOST: $HOSTNAME"
[[ "$ISSUER" =~ ^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$ ]] || fail "Invalid CERT_MANAGER_CLUSTER_ISSUER: $ISSUER"

oc whoami >/dev/null 2>&1 || fail 'OpenShift session expired. Run oc login on your Mac.'
CLUSTER="$(oc config current-context)"
USER="$(oc whoami)"
VERSION="$(tr -d '[:space:]' < VERSION)"

if [[ "$AADOS_ENV" == prod ]]; then
  echo 'WARNING: AadOS has a single-user password gate but no email OAuth or per-account authorization. Do not ingest personal email yet.'
  printf 'Deploy version %s to PRODUCTION namespace %s on cluster %s? Type DEPLOY-PROD: ' "$VERSION" "$NAMESPACE" "$CLUSTER"
  read -r CONFIRMATION
  [[ "$CONFIRMATION" == DEPLOY-PROD ]] || fail 'Production deployment cancelled.'
fi

if ! oc get namespace "$NAMESPACE" >/dev/null 2>&1; then
  if [[ "$AADOS_ENV" == prod ]]; then
    fail "Production namespace $NAMESPACE does not exist. Create it explicitly first."
  fi
  echo "Creating project $NAMESPACE..."
  oc new-project "$NAMESPACE" --display-name='AadOS' >/dev/null || fail "Cannot create namespace $NAMESPACE."
fi

oc auth can-i create buildconfigs.build.openshift.io -n "$NAMESPACE" | grep -qx yes || fail 'Missing BuildConfig creation permission.'
oc auth can-i create deployments.apps -n "$NAMESPACE" | grep -qx yes || fail 'Missing Deployment creation permission.'
oc auth can-i create ingresses.networking.k8s.io -n "$NAMESPACE" | grep -qx yes || fail 'Missing Ingress creation permission.'
oc get clusterissuer "$ISSUER" >/dev/null 2>&1 || fail "Missing or unreadable ClusterIssuer: $ISSUER"
oc get ingressclass openshift-default >/dev/null 2>&1 || fail 'Missing or unreadable openshift-default IngressClass.'

# Only development creates a secret automatically, never production.
if ! oc get secret aados-api-secrets -n "$NAMESPACE" >/dev/null 2>&1; then
  [[ "$AADOS_ENV" == dev ]] || fail "Create secret aados-api-secrets (key secret_key_base) in $NAMESPACE first."
  command -v openssl >/dev/null 2>&1 || fail 'openssl is required to generate the development Phoenix secret.'
  echo 'Creating a new development-only Phoenix secret in OpenShift (not printed or committed).'
  openssl rand -hex 48 | tr -d '\n' | oc create secret generic aados-api-secrets --from-file=secret_key_base=/dev/stdin -n "$NAMESPACE" >/dev/null
fi
[[ -n "$(oc get secret aados-api-secrets -n "$NAMESPACE" -o jsonpath='{.data.secret_key_base}')" ]] || fail 'OpenShift secret aados-api-secrets lacks key secret_key_base.'

secret_field() {
  oc get secret aados-api-secrets -n "$NAMESPACE" -o "go-template={{index .data \"$1\"}}" 2>/dev/null || true
}
b64() { printf %s "$1" | base64 | tr -d '\n'; }
unb64() { printf %s "$1" | node -e "let s=''; process.stdin.on('data', d => s += d).on('end', () => process.stdout.write(Buffer.from(s, 'base64').toString()))"; }

# The password is shown once. Only its scrypt hash is stored in OpenShift.
AADOS_LOGIN_PASSWORD=""
LOGIN_CHANGED=false
USER_B64="$(secret_field aados-user)"
PASSWORD_HASH_B64="$(secret_field aados-password-hash)"
if [[ "$RESET_USER" == true || -z "$USER_B64" || "$USER_B64" == '<no value>' || -z "$PASSWORD_HASH_B64" || "$PASSWORD_HASH_B64" == '<no value>' ]]; then
  AADOS_LOGIN_USER="${AADOS_LOGIN_USER:-u-$(node -e "process.stdout.write(require('crypto').randomBytes(6).toString('hex'))")}"
  [[ "$AADOS_LOGIN_USER" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$ ]] || fail 'AADOS_LOGIN_USER must be 3-64 letters, numbers, dots, underscores or hyphens.'
  AADOS_LOGIN_PASSWORD="$(node --input-type=module -e "import { generatePassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(generatePassword())")"
  AADOS_LOGIN_HASH="$(AADOS_PASSWORD="$AADOS_LOGIN_PASSWORD" node --input-type=module -e "import { hashPassword } from './apps/web/src/lib/server/password.js'; process.stdout.write(await hashPassword(process.env.AADOS_PASSWORD))")"
  oc patch secret aados-api-secrets -n "$NAMESPACE" --type=merge \
    -p "{\"data\":{\"aados-user\":\"$(b64 "$AADOS_LOGIN_USER")\",\"aados-password-hash\":\"$(b64 "$AADOS_LOGIN_HASH")\"}}" >/dev/null
  LOGIN_CHANGED=true
else
  AADOS_LOGIN_USER="$(unb64 "$USER_B64")"
fi

LOGDIR="${AADOS_DEPLOY_LOG_DIR:-$ROOT/build/deploy}"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$AADOS_ENV-$(date -u +%Y%m%dT%H%M%SZ).log"
# Keep credential output out of the deployment log while still showing it in the terminal.
exec 3>&1
exec > >(tee -a "$LOG") 2>&1
on_error() {
  local status=$?
  trap - ERR
  echo "Deployment failed (exit $status). Version $VERSION NOT verified as deployed. Log: $LOG" >&2
  if [[ "$LOGIN_CHANGED" == true ]]; then
    echo '' >&3
    echo 'AadOS login was created/reset before the failure. Save it for the next attempt:' >&3
    echo "  URL:      https://$HOSTNAME" >&3
    echo "  Username: $AADOS_LOGIN_USER" >&3
    echo "  Password: $AADOS_LOGIN_PASSWORD   (shown once)" >&3
    echo '' >&3
  fi
  oc get pods -n "$NAMESPACE" -l app.kubernetes.io/part-of=aados -o wide >&2 || true
  oc get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -n 15 >&2 || true
  exit "$status"
}
trap on_error ERR

echo "AadOS v$VERSION | cluster=$CLUSTER | oc user=$USER | namespace=$NAMESPACE | environment=$AADOS_ENV"
echo "HTTPS URL: https://$HOSTNAME | certificate issuer=$ISSUER"
echo 'No Helm dependency. Using OpenShift ImageStreams and binary Docker BuildConfigs.'

cleanup_finished_build_pods() {
  local phase pod
  for phase in Succeeded Failed; do
    while IFS= read -r pod; do
      [[ -n "$pod" ]] || continue
      oc delete "$pod" -n "$NAMESPACE" --ignore-not-found=true >/dev/null
    done < <(oc get pods -n "$NAMESPACE" -l openshift.io/build.name \
      --field-selector="status.phase=$phase" -o name 2>/dev/null || true)
  done
}

# BuildConfig history limits prune old Build objects; terminal build pods need an explicit sweep.
# Never remove New, Pending or Running build pods.
echo 'Cleaning up completed and failed build pods...'
cleanup_finished_build_pods

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
echo 'Cleaning up build pods from this successful build...'
cleanup_finished_build_pods

# Apply private ClusterIP services/deployments only after both images are built.
# Existing deployments need a restart to pull the updated :latest ImageStreamTag.
EXISTING_API=false
EXISTING_WEB=false
oc get deployment "$APP_NAME-api" -n "$NAMESPACE" >/dev/null 2>&1 && EXISTING_API=true
oc get deployment "$APP_NAME-web" -n "$NAMESPACE" >/dev/null 2>&1 && EXISTING_WEB=true
oc process -f openshift/app.yaml \
  -p "APP_NAME=$APP_NAME" \
  -p "NAMESPACE=$NAMESPACE" \
  -p "HOSTNAME=$HOSTNAME" \
  -p "CERT_ISSUER=$ISSUER" | oc apply -n "$NAMESPACE" -f -
if [[ "$EXISTING_API" == true ]]; then oc rollout restart "deployment/$APP_NAME-api" -n "$NAMESPACE"; fi
if [[ "$EXISTING_WEB" == true ]]; then oc rollout restart "deployment/$APP_NAME-web" -n "$NAMESPACE"; fi

for component in api web; do
  echo "Verifying rollout for $APP_NAME-$component..."
  if ! oc rollout status "deployment/$APP_NAME-$component" -n "$NAMESPACE" --timeout=300s; then
    oc logs "deployment/$APP_NAME-$component" -n "$NAMESPACE" --tail=60 || true
    existing_var="EXISTING_${component^^}"
    if [[ "${!existing_var}" == true ]]; then
      echo "Rolling $APP_NAME-$component back to its previous Deployment revision..." >&2
      oc rollout undo "deployment/$APP_NAME-$component" -n "$NAMESPACE" || true
      oc rollout status "deployment/$APP_NAME-$component" -n "$NAMESPACE" --timeout=90s || true
    fi
    fail "Rollout failed for $APP_NAME-$component; inspect log $LOG"
  fi
done

oc get deployment "$APP_NAME-api" "$APP_NAME-web" -n "$NAMESPACE"
echo "Route: oc get routes -n '$NAMESPACE'"
echo "TLS: oc get certificate '$APP_NAME-tls' -n '$NAMESPACE'"
echo "Local access: oc port-forward -n $NAMESPACE svc/$APP_NAME-web 3000:3000"
echo 'Then open http://localhost:3000'
echo "Ensure DNS points $HOSTNAME to the OpenShift router; cert-manager manages renewal."
echo "Log: $LOG"
{
  echo ''
  echo "Deployment complete — AadOS v$VERSION is live."
  echo "  URL:      https://$HOSTNAME"
  echo "  Username: $AADOS_LOGIN_USER"
  if [[ "$LOGIN_CHANGED" == true ]]; then
    echo "  Password: $AADOS_LOGIN_PASSWORD   (shown once - save it now)"
  fi
  echo "  Reset:    ./bin/oc-deploy.sh --reset-user"
} >&3
