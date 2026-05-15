#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/publish-function-image.sh <target-region> [tag]

Copies the OCI Functions event-ingest image into the target region's OCIR.
OCI Functions requires the image to live in the same region as the Function.

Environment:
  OCIR_NAMESPACE      Tenancy namespace. If empty, the script tries OCI CLI.
  OCI_PROFILE         OCI CLI profile for namespace lookup. Default: DEFAULT
  OCI_AUTH            OCI CLI auth mode for namespace lookup, for example security_token.
  SOURCE_REGISTRY     Source registry. Default: fra.ocir.io
  TARGET_REGISTRY     Target registry. Default: ocir.<target-region>.oci.oraclecloud.com
  FUNCTION_IMAGE_REPO Repository name. Default: oci-defense-grid/event-ingest
  OCIR_USERNAME       Optional docker/podman username for registry login.
  OCIR_AUTH_TOKEN     Optional auth token. If username is set and token is empty,
                      the script prompts without echoing input.
  CONTAINER_ENGINE    podman or docker. Auto-detected when empty.

Example:
  OCIR_NAMESPACE=fr9qm01oq44x \
  OCIR_USERNAME='fr9qm01oq44x/oracleidentitycloudservice/name@example.com' \
  scripts/publish-function-image.sh us-ashburn-1 0.1.1
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit 0
fi

target_region="$1"
tag="${2:-0.1.1}"
repo="${FUNCTION_IMAGE_REPO:-oci-defense-grid/event-ingest}"
source_registry="${SOURCE_REGISTRY:-fra.ocir.io}"
target_registry="${TARGET_REGISTRY:-ocir.${target_region}.oci.oraclecloud.com}"
oci_profile="${OCI_PROFILE:-DEFAULT}"
oci_auth="${OCI_AUTH:-}"
namespace="${OCIR_NAMESPACE:-}"

engine="${CONTAINER_ENGINE:-}"
if [[ -z "$engine" ]]; then
  if command -v podman >/dev/null 2>&1; then
    engine="podman"
  elif command -v docker >/dev/null 2>&1; then
    engine="docker"
  else
    echo "podman or docker is required." >&2
    exit 1
  fi
fi

if [[ -z "$namespace" && -x "$(command -v oci || true)" ]]; then
  oci_args=(--profile "$oci_profile" --region "$target_region" --query data --raw-output)
  if [[ -n "$oci_auth" ]]; then
    oci_args+=(--auth "$oci_auth")
  fi
  namespace="$(oci os ns get "${oci_args[@]}" 2>/dev/null || true)"
fi

if [[ -z "$namespace" ]]; then
  echo "OCIR_NAMESPACE is required when OCI CLI namespace lookup is unavailable." >&2
  exit 1
fi

source_image="${SOURCE_IMAGE:-${source_registry}/${namespace}/${repo}:${tag}}"
target_image="${TARGET_IMAGE:-${target_registry}/${namespace}/${repo}:${tag}}"

login_if_requested() {
  local registry="$1"
  if [[ -z "${OCIR_USERNAME:-}" ]]; then
    return 0
  fi

  local token="${OCIR_AUTH_TOKEN:-}"
  if [[ -z "$token" ]]; then
    read -rsp "OCIR auth token for ${OCIR_USERNAME}: " token
    echo
  fi

  printf '%s\n' "$token" | "$engine" login "$registry" -u "$OCIR_USERNAME" --password-stdin >/dev/null
}

login_if_requested "$source_registry"
login_if_requested "$target_registry"

if command -v skopeo >/dev/null 2>&1; then
  skopeo copy "docker://${source_image}" "docker://${target_image}"
else
  "$engine" pull "$source_image"
  "$engine" tag "$source_image" "$target_image"
  "$engine" push "$target_image"
fi

cat <<EOF
Published image:
  ${target_image}

Add to infra/terraform/demo.tfvars:
  function_image = "${target_image}"
EOF
