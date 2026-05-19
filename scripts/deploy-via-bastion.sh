#!/usr/bin/env bash
set -euo pipefail

BASTION_HOST="${BASTION_HOST:-82.70.59.158}"
BASTION_USER="${BASTION_USER:-ubuntu}"
VM_USER="${VM_USER:-ubuntu}"
VM_HOSTS="${VM_HOSTS:-}"
VM_DNS_PATTERN="${VM_DNS_PATTERN:-ocidefense-9591c7-%d.private.ocidefense.oraclevcn.com}"
VM_DNS_SCAN_MAX="${VM_DNS_SCAN_MAX:-12}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/oci-defense-grid}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/oci-defense-known-hosts}"
REDIS_HOST="${REDIS_HOST:-}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_TLS="${REDIS_TLS:-true}"
LIVE_PLAYER_TTL_SECONDS="${LIVE_PLAYER_TTL_SECONDS:-60}"
EVENT_INGEST_ROUTE_MODE="${EVENT_INGEST_ROUTE_MODE:-}"
OCI_GENAI_ENDPOINT="${OCI_GENAI_ENDPOINT:-}"
OCI_GENAI_BEARER_TOKEN="${OCI_GENAI_BEARER_TOKEN:-}"
OCI_GENAI_MODEL="${OCI_GENAI_MODEL:-}"
OCI_GENAI_COACH_MODEL="${OCI_GENAI_COACH_MODEL:-}"
OCI_GENAI_COMPARTMENT_OCID="${OCI_GENAI_COMPARTMENT_OCID:-}"
OCI_GENAI_TIMEOUT_MS="${OCI_GENAI_TIMEOUT_MS:-25000}"
OPS_ACCESS_TOKEN="${OPS_ACCESS_TOKEN:-}"
ADB_USER="${ADB_USER:-ADMIN}"
ADB_PASSWORD="${ADB_PASSWORD:-}"
ADB_CONNECT_STRING="${ADB_CONNECT_STRING:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${SSH_KEY:-${REPO_ROOT}/infra/terraform/.keys/oci-defense-grid-demo}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

discover_vm_hosts() {
  ssh \
    -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    "${BASTION_USER}@${BASTION_HOST}" \
    "pattern='${VM_DNS_PATTERN}'; for i in \$(seq 1 '${VM_DNS_SCAN_MAX}'); do host=\$(printf \"\$pattern\" \"\$i\"); getent hosts \"\$host\" >/dev/null 2>&1 && printf '%s\n' \"\$host\"; done; true"
}

if [[ -z "$VM_HOSTS" ]]; then
  echo "Discovering VM hosts via bastion DNS pattern: ${VM_DNS_PATTERN}"
  VM_HOSTS="$(discover_vm_hosts | tr '\n' ' ')"
fi

if [[ -z "$(printf '%s' "$VM_HOSTS" | tr -d '[:space:]')" ]]; then
  echo "No VM hosts found. Set VM_HOSTS manually or update VM_DNS_PATTERN." >&2
  exit 1
fi

deploy_host() {
  local host="$1"
  local remote_command
  local encoded_env

  remote_command="set -e"
  if [[ -n "$REDIS_HOST" ]]; then
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-redis.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/redis.conf >/dev/null"
    remote_command="${remote_command}; printf '%s\n' 'REDIS_HOST=${REDIS_HOST}' 'REDIS_PORT=${REDIS_PORT}' 'REDIS_TLS=${REDIS_TLS}' 'LIVE_PLAYER_TTL_SECONDS=${LIVE_PLAYER_TTL_SECONDS}' | sudo tee /etc/oci-defense-redis.env >/dev/null"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  if [[ -n "$EVENT_INGEST_ROUTE_MODE" ]]; then
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'Environment=EVENT_INGEST_ROUTE_MODE=${EVENT_INGEST_ROUTE_MODE}' | sudo tee /etc/systemd/system/oci-defense-api.service.d/event-ingest.conf >/dev/null"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  if [[ -n "$OCI_GENAI_ENDPOINT" || -n "$OCI_GENAI_BEARER_TOKEN" || -n "$OCI_GENAI_MODEL" || -n "$OCI_GENAI_COACH_MODEL" || -n "$OCI_GENAI_COMPARTMENT_OCID" ]]; then
    encoded_env="$(printf '%s\n' "OCI_GENAI_ENDPOINT=${OCI_GENAI_ENDPOINT}" "OCI_GENAI_BEARER_TOKEN=${OCI_GENAI_BEARER_TOKEN}" "OCI_GENAI_MODEL=${OCI_GENAI_MODEL}" "OCI_GENAI_COACH_MODEL=${OCI_GENAI_COACH_MODEL}" "OCI_GENAI_COMPARTMENT_OCID=${OCI_GENAI_COMPARTMENT_OCID}" "OCI_GENAI_TIMEOUT_MS=${OCI_GENAI_TIMEOUT_MS}" | base64 | tr -d '\n')"
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-genai.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/genai.conf >/dev/null"
    remote_command="${remote_command}; printf '%s' '${encoded_env}' | base64 -d | sudo tee /etc/oci-defense-genai.env >/dev/null"
    remote_command="${remote_command}; sudo chmod 600 /etc/oci-defense-genai.env"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  if [[ -n "$OPS_ACCESS_TOKEN" ]]; then
    encoded_env="$(printf '%s\n' "OPS_ACCESS_TOKEN=${OPS_ACCESS_TOKEN}" | base64 | tr -d '\n')"
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-ops.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/ops.conf >/dev/null"
    remote_command="${remote_command}; printf '%s' '${encoded_env}' | base64 -d | sudo tee /etc/oci-defense-ops.env >/dev/null"
    remote_command="${remote_command}; sudo chmod 600 /etc/oci-defense-ops.env"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  if [[ -n "$ADB_CONNECT_STRING" && -n "$ADB_PASSWORD" ]]; then
    encoded_env="$(printf '%s\n' "ADB_USER=${ADB_USER}" "ADB_PASSWORD=${ADB_PASSWORD}" "ADB_CONNECT_STRING=${ADB_CONNECT_STRING}" | base64 | tr -d '\n')"
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-adb.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/adb.conf >/dev/null"
    remote_command="${remote_command}; printf '%s' '${encoded_env}' | base64 -d | sudo tee /etc/oci-defense-adb.env >/dev/null"
    remote_command="${remote_command}; sudo chmod 600 /etc/oci-defense-adb.env"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  remote_command="${remote_command}; cd '${DEPLOY_PATH}'; sudo git fetch origin '${DEPLOY_BRANCH}'; sudo git checkout '${DEPLOY_BRANCH}'; sudo git pull --ff-only origin '${DEPLOY_BRANCH}'; sudo npm install --omit=dev; sudo systemctl restart oci-defense-api nginx; sudo systemctl is-active --quiet oci-defense-api; sudo systemctl is-active --quiet nginx; sudo git rev-parse --short HEAD"

  echo "==> Deploying ${host}"
  ssh \
    -i "$SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -o ProxyCommand="ssh -i '$SSH_KEY' -o StrictHostKeyChecking=no -o UserKnownHostsFile='$KNOWN_HOSTS' -W %h:%p ${BASTION_USER}@${BASTION_HOST}" \
    "${VM_USER}@${host}" \
    "$remote_command"
}

for host in $VM_HOSTS; do
  deploy_host "$host"
done
