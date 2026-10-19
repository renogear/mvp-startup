#!/usr/bin/env bash
set -euo pipefail
# Isolated orchestration tests. gh, curl and npm below are intentional mocks;
# these tests never connect to GitHub or use the live application on port 3000.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ ! -x "$repo_root/.venv/bin/python" ]]; then
  printf '%s\n' 'Install dependencies first: bash scripts/codespaces-install.sh' >&2
  exit 1
fi
suite_dir="$(mktemp -d /tmp/permitpilot-codespaces-scripts.XXXXXX)"
mkdir -p "$suite_dir/bin"
active_test_root=''
cleanup() {
  if [[ -n "$active_test_root" ]]; then
    env PATH="$suite_dir/bin:$PATH" MOCK_STATE="$active_test_root/state" MOCK_CASE=cleanup \
      bash "$active_test_root/scripts/codespaces-stop.sh" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
cat > "$suite_dir/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_STATE/gh-trace"
if [[ "$MOCK_CASE" == auth-failure || ( "$MOCK_CASE" == stored-login && -n "${GITHUB_TOKEN:-}" ) ]]; then
  echo 'Mock CLI authentication failed' >&2
  exit 1
fi
if [[ "${3:-}" == visibility ]]; then
  printf '%s\n' verified-command > "$MOCK_STATE/visibility-called"
  exit 0
fi
if [[ "$MOCK_CASE" == public ]]; then
  printf '%s\n' '[{"sourcePort":3000,"visibility":"public"}]'
else
  printf '%s\n' '[{"sourcePort":3000,"visibility":"private"}]'
fi
MOCK
cat > "$suite_dir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == */api/plans/session* ]]; then
  read -r mode < "$MOCK_STATE/web-mode"
  if [[ "$mode" == 1 && -f "$MOCK_STATE/visibility-called" ]]; then
    printf '%s\n' '{"mode":"private-codespace","enabled":true}'
  else
    printf '%s\n' '{"mode":"private-codespace","enabled":false}'
  fi
fi
MOCK
cat > "$suite_dir/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${2:-}" == dev ]]; then
  printf '%s\n' "${PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED:-unset}" > "$MOCK_STATE/web-mode"
  printf '%s\n' "${PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED:-unset}" >> "$MOCK_STATE/web-modes"
else
  printf '%s\n' 'extraction worker ready'
fi
exec /bin/sleep 600
MOCK
cat > "$suite_dir/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exec /bin/sleep 0.05
MOCK
chmod +x "$suite_dir/bin/"*
for test_case in private stored-login auth-failure public; do
  test_root="$suite_dir/$test_case"
  active_test_root="$test_root"
  mkdir -p "$test_root/scripts" "$test_root/.venv/bin" "$test_root/node_modules/.bin" "$test_root/public" "$test_root/state"
  cp "$repo_root"/scripts/codespaces-{env,start,service,stop}.sh "$test_root/scripts/"
  ln -s "$repo_root/.venv/bin/python" "$test_root/.venv/bin/python"
  printf '#!/bin/sh\nexit 0\n' > "$test_root/node_modules/.bin/next"
  chmod +x "$test_root/node_modules/.bin/next"
  printf '%s\n' 'Mock PDF worker' > "$test_root/public/pdf.worker.min.mjs"
  exit_status=0
  env PATH="$suite_dir/bin:$PATH" GITHUB_TOKEN=mock-repository-token CODESPACES=true CODESPACE_NAME=mock-private-test \
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN=app.github.dev \
    MOCK_STATE="$test_root/state" MOCK_CASE="$test_case" \
    bash "$test_root/scripts/codespaces-start.sh" > "$test_root/start.log" 2>&1 || exit_status=$?
  service_hash="$(printf '%s' "$test_root" | sha256sum | cut -c1-12)"
  service_dir="/tmp/permitpilot-codespaces-$service_hash"
  if [[ "$test_case" == private || "$test_case" == stored-login ]]; then
    test "$exit_status" == 0
    test "$(cat "$test_root/state/web-modes")" == $'0\n1'
    test -f "$test_root/state/visibility-called"
    rg -q 'Port 3000 is verified PRIVATE' "$test_root/start.log"
    rg -q 'visibility 3000:private --codespace mock-private-test' "$test_root/state/gh-trace"
  else
    test "$exit_status" != 0
    test "$(cat "$test_root/state/web-modes")" == 0
    test ! -e "$service_dir/web.pid"
    if [[ "$test_case" == public ]]; then
      rg -q 'not confirmed Private' "$test_root/start.log"
    else
      rg -q 'could not inspect' "$test_root/start.log"
    fi
  fi
  env PATH="$suite_dir/bin:$PATH" MOCK_STATE="$test_root/state" MOCK_CASE="$test_case" \
    bash "$test_root/scripts/codespaces-stop.sh" > "$test_root/stop.log"
  test ! -e "$service_dir/web.pid"
  test ! -e "$service_dir/worker.pid"
  active_test_root=''
  printf 'PASS %s: script lifecycle and receipt propagation\n' "$test_case"
done
printf 'Harness files: %s\n' "$suite_dir"
