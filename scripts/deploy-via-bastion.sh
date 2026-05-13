#!/usr/bin/env bash
set -euo pipefail

BASTION_HOST="${BASTION_HOST:-82.70.59.158}"
BASTION_USER="${BASTION_USER:-ubuntu}"
VM_USER="${VM_USER:-ubuntu}"
VM_HOSTS="${VM_HOSTS:-10.42.20.153 10.42.20.192}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/oci-defense-grid}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/oci-defense-known-hosts}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${SSH_KEY:-${REPO_ROOT}/infra/terraform/.keys/oci-defense-grid-demo}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

deploy_host() {
  local host="$1"
  echo "==> Deploying ${host}"
  ssh \
    -i "$SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -o ProxyCommand="ssh -i '$SSH_KEY' -o StrictHostKeyChecking=no -o UserKnownHostsFile='$KNOWN_HOSTS' -W %h:%p ${BASTION_USER}@${BASTION_HOST}" \
    "${VM_USER}@${host}" \
    "set -e; cd '${DEPLOY_PATH}'; sudo git fetch origin '${DEPLOY_BRANCH}'; sudo git checkout '${DEPLOY_BRANCH}'; sudo git pull --ff-only origin '${DEPLOY_BRANCH}'; sudo npm install --omit=dev; sudo systemctl restart oci-defense-api nginx; sudo systemctl is-active --quiet oci-defense-api; sudo systemctl is-active --quiet nginx; sudo git rev-parse --short HEAD"
}

for host in $VM_HOSTS; do
  deploy_host "$host"
done
