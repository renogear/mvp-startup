#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/codespaces-env.sh"
cd "$PERMITPILOT_REPO_ROOT"

if [[ "${CODESPACES:-}" != true || ! "${CODESPACE_NAME:-}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ \
    || ! "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" =~ ^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]+$ ]]; then
  printf '%s\n' 'Run this startup script in GitHub Codespaces. For a local checkout, follow README.md.' >&2
  exit 1
fi
for required_command in gh rg curl timeout flock setsid; do
  command -v "$required_command" >/dev/null || {
    printf 'Missing %s. Rebuild the dev container.\n' "$required_command" >&2
    exit 1
  }
done
if [[ ! -x "$PERMITPILOT_PYTHON" || ! -x node_modules/.bin/next || ! -s public/pdf.worker.min.mjs ]]; then
  printf '%s\n' 'Dependencies are incomplete. Run: bash scripts/codespaces-install.sh' >&2
  exit 1
fi
"$PERMITPILOT_PYTHON" -c 'import pymupdf; assert pymupdf.VersionBind == "1.26.6"'
node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(":memory:"); db.close();'

# Lock only startup, never the lifetime of the running application. A fresh
# privacy check is required on every startup, including an existing Codespace.
exec 9>"${PERMITPILOT_SERVICE_DIR}/start.lock"
flock -x 9
export PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED=0
export PERMITPILOT_CODESPACES_USE_STORED_GH_AUTH=0
permitpilot_stop_service web
startup_complete=0
cleanup_failed_start() {
  if [[ "$startup_complete" != 1 ]]; then
    permitpilot_stop_service web
    printf 'The web service is stopped. Inspect %s/{web,ports}.log and rerun startup after fixing the error.\n' \
      "$PERMITPILOT_SERVICE_DIR" >&2
  fi
}
trap cleanup_failed_start EXIT

# An actual registered port is required by gh's visibility command. Bootstrap
# the web server with review sessions disabled while the forwarding service
# discovers port 3000. No document API is enabled by this temporary process.
permitpilot_start_service worker
permitpilot_start_service web
printf '%s\n' 'Starting the workbench with review sessions locked while port privacy is verified...'
server_ready=0
for ((attempt = 0; attempt < 90; attempt++)); do
  if permitpilot_service_running web \
      && curl --fail --silent --max-time 5 -o /dev/null http://127.0.0.1:3000/review; then
    server_ready=1
    break
  fi
  sleep 2
done
if [[ "$server_ready" != 1 ]]; then
  printf '%s\n' 'The web server did not become ready.' >&2
  exit 1
fi

ports_file="${PERMITPILOT_SERVICE_DIR}/ports.json"
ports_log="${PERMITPILOT_SERVICE_DIR}/ports.log"
: > "$ports_log"
port_registered=0
for ((attempt = 0; attempt < 30; attempt++)); do
  if ! permitpilot_gh_codespace ports --codespace "$CODESPACE_NAME" \
      --json sourcePort,visibility > "$ports_file" 2>> "$ports_log"; then
    if [[ "$attempt" == 0 ]]; then
      printf '%s\n' 'The automatic GitHub token could not inspect the Codespace; checking an existing GitHub CLI login...'
      export PERMITPILOT_CODESPACES_USE_STORED_GH_AUTH=1
    fi
    if [[ "$attempt" != 0 ]] || ! permitpilot_gh_codespace ports --codespace "$CODESPACE_NAME" \
        --json sourcePort,visibility > "$ports_file" 2>> "$ports_log"; then
      printf '%s\n' 'GitHub CLI could not inspect this Codespace. Use the browser-login instructions in docs/CODESPACES.md, then rerun startup; review sessions remain disabled.' >&2
      exit 1
    fi
  fi
  if node -e 'const fs=require("node:fs"); const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(Array.isArray(rows)&&rows.some(p=>p.sourcePort===3000)?0:1)' "$ports_file"; then
    port_registered=1
    break
  fi
  sleep 2
done
if [[ "$port_registered" != 1 ]]; then
  printf '%s\n' 'Port 3000 was not registered. Open the Codespaces Ports panel, add port 3000 with Private visibility, and rerun startup.' >&2
  exit 1
fi

if ! permitpilot_gh_codespace ports visibility 3000:private --codespace "$CODESPACE_NAME" \
    >> "$ports_log" 2>&1; then
  printf '%s\n' 'GitHub could not set port 3000 to Private. Review sessions remain disabled.' >&2
  exit 1
fi
privacy_verified=0
for ((attempt = 0; attempt < 5; attempt++)); do
  if ! permitpilot_gh_codespace ports --codespace "$CODESPACE_NAME" \
      --json sourcePort,visibility > "$ports_file" 2>> "$ports_log"; then
    printf '%s\n' 'GitHub could not confirm port visibility. Review sessions remain disabled.' >&2
    exit 1
  fi
  if node -e 'const fs=require("node:fs"); const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const port=Array.isArray(rows)?rows.find(p=>p.sourcePort===3000):null; process.exit(port?.visibility==="private"?0:1)' "$ports_file"; then
    privacy_verified=1
    break
  fi
  sleep 2
done
if [[ "$privacy_verified" != 1 ]]; then
  printf '%s\n' 'Port 3000 is not confirmed Private. Review sessions remain disabled.' >&2
  exit 1
fi

# Only this successful provider check enables browser sessions. The environment
# flag belongs to the supervised process; no permanent approval file is stored.
permitpilot_stop_service web
export PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED=1
permitpilot_start_service web
browser_host="${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
ready=0
for ((attempt = 0; attempt < 90; attempt++)); do
  worker_pid=''
  if [[ -f "${PERMITPILOT_SERVICE_DIR}/worker.child.pid" ]]; then
    read -r worker_pid < "${PERMITPILOT_SERVICE_DIR}/worker.child.pid" || true
  fi
  if permitpilot_service_running worker && permitpilot_service_running web \
      && [[ "$worker_pid" =~ ^[0-9]+$ ]] && kill -0 "$worker_pid" 2>/dev/null \
      && rg -q -F 'extraction worker ready' "${PERMITPILOT_SERVICE_DIR}/worker.log" \
      && curl --fail --silent --max-time 5 --header "Host: ${browser_host}" \
        http://127.0.0.1:3000/api/plans/session > "${PERMITPILOT_SERVICE_DIR}/readiness.json" \
      && node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(value.enabled===true&&value.mode==="private-codespace"?0:1)' \
        "${PERMITPILOT_SERVICE_DIR}/readiness.json"; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  printf '%s\n' 'The private workbench or extraction worker did not become ready.' >&2
  exit 1
fi

startup_complete=1
printf '\nPermitPilot is ready: https://%s/review\n' "$browser_host"
printf 'Port 3000 is verified PRIVATE. Logs: %s/{web,worker,ports}.log\n' "$PERMITPILOT_SERVICE_DIR"
printf '%s\n' 'Private originals and reviews are retained in .permitpilot; no compliance rules are active.'
