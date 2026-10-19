#!/usr/bin/env bash
# Detached, restartable service supervisor; invoked by codespaces-start.sh.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/codespaces-env.sh"
cd "$PERMITPILOT_REPO_ROOT"

kind="${1:-}"
case "$kind" in
  web) command=(npm run dev -- --hostname 0.0.0.0 --port 3000) ;;
  worker) command=(npm run plan:worker) ;;
  *) printf '%s\n' 'Expected service: web or worker' >&2; exit 2 ;;
esac

child_pid=''
cleanup() {
  trap - TERM INT EXIT
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  rm -f "${PERMITPILOT_SERVICE_DIR}/${kind}.child.pid"
}
trap 'exit 0' TERM INT
trap cleanup EXIT

while true; do
  printf '[%s] Starting %s\n' "$(date -u +%FT%TZ)" "$kind"
  "${command[@]}" &
  child_pid=$!
  printf '%s\n' "$child_pid" > "${PERMITPILOT_SERVICE_DIR}/${kind}.child.pid"
  exit_status=0
  wait "$child_pid" || exit_status=$?
  child_pid=''
  rm -f "${PERMITPILOT_SERVICE_DIR}/${kind}.child.pid"
  printf '[%s] %s exited (%s); restarting in 3 seconds.\n' "$(date -u +%FT%TZ)" "$kind" "$exit_status"
  sleep 3
done
