#!/usr/bin/env bash
set -euo pipefail

BASTION_HOST="${BASTION_HOST:-82.70.59.158}"
BASTION_USER="${BASTION_USER:-ubuntu}"
VM_USER="${VM_USER:-ubuntu}"
VM_HOSTS="${VM_HOSTS:-10.42.20.153 10.42.20.192}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/oci-defense-grid}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/oci-defense-known-hosts}"
REDIS_HOST="${REDIS_HOST:-}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_TLS="${REDIS_TLS:-true}"
LIVE_PLAYER_TTL_SECONDS="${LIVE_PLAYER_TTL_SECONDS:-60}"
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

deploy_host() {
  local host="$1"
  local remote_command

  remote_command="set -e"
  if [[ -n "$REDIS_HOST" ]]; then
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-redis.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/redis.conf >/dev/null"
    remote_command="${remote_command}; printf '%s\n' 'REDIS_HOST=${REDIS_HOST}' 'REDIS_PORT=${REDIS_PORT}' 'REDIS_TLS=${REDIS_TLS}' 'LIVE_PLAYER_TTL_SECONDS=${LIVE_PLAYER_TTL_SECONDS}' | sudo tee /etc/oci-defense-redis.env >/dev/null"
    remote_command="${remote_command}; sudo systemctl daemon-reload"
  fi
  if [[ -n "$ADB_CONNECT_STRING" && -n "$ADB_PASSWORD" ]]; then
    remote_command="${remote_command}; sudo mkdir -p /etc/systemd/system/oci-defense-api.service.d"
    remote_command="${remote_command}; printf '%s\n' '[Service]' 'EnvironmentFile=-/etc/oci-defense-adb.env' | sudo tee /etc/systemd/system/oci-defense-api.service.d/adb.conf >/dev/null"
    remote_command="${remote_command}; printf '%s\n' 'ADB_USER=${ADB_USER}' 'ADB_PASSWORD=${ADB_PASSWORD}' 'ADB_CONNECT_STRING=${ADB_CONNECT_STRING}' | sudo tee /etc/oci-defense-adb.env >/dev/null"
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
