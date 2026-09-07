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

echo "==> 1/9  npm run lint"
npm run lint

echo "==> 2/9  npm run typecheck（根 + workspaces）"
npm run typecheck
npm run typecheck --workspaces --if-present

echo "==> 3/9  npm run build（core → 门面）"
# Ensure workspace junctions exist (npm workspaces may fail to create them)
if [ ! -f "node_modules/@faicad/faijs-core/package.json" ]; then
    echo "    [ci] workspace junction missing — running npm install"
    npm install
fi
npm run build

echo "==> 4/9  npm run test --workspaces"
set +o pipefail
npm run test --workspaces --if-present --no-color 2>&1 | tee /tmp/vitest-out.txt
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

echo "==> 5/9  守卫：幽灵依赖 / workspaces 顺序 / 包图无环 / 导出面"
node scripts/check-ghost-deps.mjs
node scripts/check-workspaces-order.mjs
npx madge --circular packages/core/src packages/gear-lib-demo/src
node scripts/api-surface-snapshot.mjs
# P1：vendored/brepjs 移植树——D8 层边界（U9 断言：csg/、ns/csg.ts 永不搬入）
node scripts/check-layer-boundaries.mjs
# P10-④：U8 品牌守卫（用户可见面零 brepjs，E6）
node scripts/check-vendored-branding.mjs

echo "==> 6/9  demo e2e（dev server 模式，M7 链路）"
cd "$ROOT"
npx playwright install chromium
npm run test:e2e -w @faicad/faijs-demo

echo "==> 7/9  demo e2e:preview（CDN/importmap 产物路径）"
npm run test:e2e:preview -w @faicad/faijs-demo

echo "==> 8/9  npm run doc-sync（文档规范检查）"
npm run doc-sync

echo "==> 9/9  npm pack（3d_editor tarball）"
cd "$ROOT"
npm pack

echo "==> All CI checks passed"
