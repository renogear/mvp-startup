#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/codespaces-env.sh"
cd "$PERMITPILOT_REPO_ROOT"

node -e 'if (process.versions.node.split(".")[0] !== "24") throw new Error("PermitPilot requires Node.js 24; rebuild the dev container.")'
python3 -c 'import sys; assert sys.version_info[:2] == (3, 12), "PermitPilot requires Python 3.12; rebuild the dev container."'
command -v tesseract >/dev/null
command -v gh >/dev/null
command -v rg >/dev/null

# The lockfile and source stay unchanged. npm's postinstall copies the matching
# PDF.js worker into its gitignored public location.
npm ci --no-audit --no-fund --cache "${PERMITPILOT_SERVICE_DIR}/cache/npm"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
"$PERMITPILOT_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Existing .venv uses another Python. Rename .venv and rerun this script."'
"$PERMITPILOT_PYTHON" -m pip install --disable-pip-version-check \
  --cache-dir "${PERMITPILOT_SERVICE_DIR}/cache/pip" -r processor/requirements.txt
"$PERMITPILOT_PYTHON" -c 'import pymupdf; assert pymupdf.VersionBind == "1.26.6", "Unexpected PyMuPDF version"'
test -s public/pdf.worker.min.mjs

printf '%s\n' 'PermitPilot dependencies installed. No credentials or .env files were created.'
