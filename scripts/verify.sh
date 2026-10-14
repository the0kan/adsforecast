#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${ADSFORECAST_TEST_PORT:-5173}"
BASE_URL="http://127.0.0.1:${PORT}"
SERVER_LOG="${TMPDIR:-/tmp}/adsforecast-test-server.log"

cd "$ROOT_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Checking JavaScript syntax..."
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  node --check "$file"
done < <(git ls-files '*.js')

echo "Starting the local product server on ${BASE_URL}..."
"$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in {1..30}; do
  if curl --fail --silent --show-error "${BASE_URL}/index.html" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent --show-error "${BASE_URL}/index.html" >/dev/null; then
  echo "Local server did not become ready. Log: ${SERVER_LOG}" >&2
  exit 1
fi

export ADSFORECAST_TEST_ORIGIN="$BASE_URL"
export ADSFORECAST_BASE_URL="$BASE_URL"
export UI_AUDIT_BASE="$BASE_URL"

"$PYTHON_BIN" tests/marketing_e2e.py
"$PYTHON_BIN" tests/product_intelligence_e2e.py
"$PYTHON_BIN" tests/launch_control_plane_e2e.py
"$PYTHON_BIN" scripts/auth_quality_audit.py
"$PYTHON_BIN" scripts/data_integrity_audit.py
"$PYTHON_BIN" scripts/product_quality_audit.py
"$PYTHON_BIN" scripts/product_upgrade_audit.py
"$PYTHON_BIN" scripts/ui_audit.py

echo "AdsForecast quality suite passed."
