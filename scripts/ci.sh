#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Windows guard — use ci.ps1 instead
case "$ROOT" in
  /mnt/*)
    echo "ERROR: ci.sh is a Linux/macOS script. On Windows, run: pwsh -NoProfile scripts/ci.ps1" >&2
    exit 1
    ;;
esac

cd "$ROOT"

echo "==> 1/4  npm run lint"
npm run lint

echo "==> 2/4  npm run typecheck"
npm run typecheck

echo "==> 3/4  npx vitest run"
set +o pipefail
npx vitest run --no-color 2>&1 | tee /tmp/vitest-out.txt
exit_code=${PIPESTATUS[0]}
set -o pipefail

if [ "$exit_code" -ne 0 ]; then exit "$exit_code"; fi
# Check for unexpected stderr — allowlist known false positives
unexpected_stderr=""
while IFS= read -r line; do
  if [[ "$line" == "stderr |"* ]]; then
    IFS= read -r content
    unexpected_stderr="${unexpected_stderr}${line}"$'\n'"${content}"$'\n'
  fi
done < /tmp/vitest-out.txt
if [ -n "$unexpected_stderr" ]; then
  echo ""
  echo "ERROR: Tests produced unexpected stderr output — all test stderr must be resolved." >&2
  echo "$unexpected_stderr" >&2
  exit 1
fi

echo "==> 4/4  demo e2e (playwright)"
cd "$ROOT/demo"
# demo has its own package.json/lockfile; install first in a clean environment (no node_modules)
if [ ! -d node_modules ]; then
  npm ci
fi
# Playwright browsers (idempotent: skips if already downloaded)
npx playwright install chromium
npm run test:e2e
cd "$ROOT"

echo "==> All CI checks passed"
