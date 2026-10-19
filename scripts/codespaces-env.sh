#!/usr/bin/env bash
# Shared non-secret configuration. Source from the other Codespaces scripts.
set -euo pipefail

PERMITPILOT_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PERMITPILOT_REPO_ROOT

# GitHub supplies CODESPACES, CODESPACE_NAME and the forwarding domain. Never
# manufacture those reserved variables: app access checks rely on their origin.
export PERMITPILOT_CODESPACES_REVIEW=1
export PERMITPILOT_LOCAL_REVIEW=0
export PERMITPILOT_PYTHON="${PERMITPILOT_REPO_ROOT}/.venv/bin/python"
export PERMITPILOT_DATA_DIR="${PERMITPILOT_DATA_DIR:-${PERMITPILOT_REPO_ROOT}/.permitpilot}"

PERMITPILOT_REPO_HASH="$(printf '%s' "$PERMITPILOT_REPO_ROOT" | sha256sum | cut -c 1-12)"
export PERMITPILOT_SERVICE_DIR="/tmp/permitpilot-codespaces-${PERMITPILOT_REPO_HASH}"
umask 077
mkdir -p "$PERMITPILOT_SERVICE_DIR"

permitpilot_service_running() {
  local kind="$1" pidfile="${PERMITPILOT_SERVICE_DIR}/$1.pid" service_pid command_line
  [[ -f "$pidfile" ]] || return 1
  read -r service_pid < "$pidfile"
  [[ "$service_pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$service_pid" 2>/dev/null || return 1
  command_line="$(ps -p "$service_pid" -o args=)" || return 1
  [[ "$command_line" == *"${PERMITPILOT_REPO_ROOT}/scripts/codespaces-service.sh ${kind}"* ]]
}

permitpilot_stop_service() {
  local kind="$1" service_pid attempt
  if permitpilot_service_running "$kind"; then
    read -r service_pid < "${PERMITPILOT_SERVICE_DIR}/${kind}.pid"
    # Each supervisor and all its children have their own process group.
    kill -TERM -- "-${service_pid}" 2>/dev/null || true
    for ((attempt = 0; attempt < 40; attempt++)); do
      permitpilot_service_running "$kind" || break
      sleep 0.2
    done
    if permitpilot_service_running "$kind"; then
      kill -KILL -- "-${service_pid}" 2>/dev/null || true
    fi
  fi
  rm -f "${PERMITPILOT_SERVICE_DIR}/${kind}.pid" "${PERMITPILOT_SERVICE_DIR}/${kind}.child.pid"
}

permitpilot_start_service() {
  local kind="$1"
  if permitpilot_service_running "$kind"; then
    printf '%s is already running.\n' "$kind"
    return
  fi
  : > "${PERMITPILOT_SERVICE_DIR}/${kind}.log"
  nohup setsid bash "${PERMITPILOT_REPO_ROOT}/scripts/codespaces-service.sh" "$kind" \
    > "${PERMITPILOT_SERVICE_DIR}/${kind}.log" 2>&1 < /dev/null 9>&- &
  printf '%s\n' "$!" > "${PERMITPILOT_SERVICE_DIR}/${kind}.pid"
}

permitpilot_gh_codespace() {
  # Codespaces' automatic repository token may lack Codespaces API scope.
  # A stored user login is selected only after the initial inspection fails;
  # remove token overrides for this command without changing the app's env.
  if [[ "${PERMITPILOT_CODESPACES_USE_STORED_GH_AUTH:-0}" == 1 ]]; then
    timeout 45s env -u GH_TOKEN -u GITHUB_TOKEN GH_PROMPT_DISABLED=1 gh codespace "$@"
  else
    timeout 45s env GH_PROMPT_DISABLED=1 gh codespace "$@"
  fi
}
