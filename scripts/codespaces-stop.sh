#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/codespaces-env.sh"

exec 9>"${PERMITPILOT_SERVICE_DIR}/start.lock"
flock -x 9
for kind in web worker; do
  permitpilot_stop_service "$kind"
done
printf '%s\n' 'PermitPilot services stopped. Saved reviews and original documents were retained.'
