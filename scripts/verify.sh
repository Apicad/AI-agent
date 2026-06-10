#!/usr/bin/env bash
# Pre-deploy verification: lint → type-check → unit tests → build
# Usage: bash scripts/verify.sh
set -euo pipefail

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "═══ Pixel Agents — Pre-deploy checks ═══"

# 1. Shared types
echo ""
echo "── Shared (TypeScript) ──"
if cd shared && npx tsc -p tsconfig.json --noEmit 2>/dev/null; then ok "shared tsc"; else fail "shared tsc"; fi
cd ..

# 2. Webview lint
echo ""
echo "── Webview (lint) ──"
if cd webview-ui && npx eslint src --max-warnings 0 2>/dev/null; then ok "webview eslint"; else fail "webview eslint"; fi
cd ..

# 3. Webview type-check
echo ""
echo "── Webview (TypeScript) ──"
if cd webview-ui && npx tsc -b --noEmit 2>/dev/null; then ok "webview tsc"; else fail "webview tsc"; fi
cd ..

# 4. Server tests
echo ""
echo "── Server (unit tests) ──"
if cd server && npm test --silent 2>/dev/null; then ok "server tests"; else fail "server tests"; fi
cd ..

# 5. Full build
echo ""
echo "── Full build ──"
if npm run build --silent 2>/dev/null; then ok "npm run build"; else fail "npm run build"; fi

# 6. Asset manifests — ensure all furniture manifests have type:asset
echo ""
echo "── Asset manifests ──"
MISSING=0
for manifest in webview-ui/public/assets/furniture/*/manifest.json; do
  if ! grep -q '"type"' "$manifest"; then
    echo "    MISSING type field: $manifest"
    MISSING=$((MISSING+1))
  fi
done
if [ "$MISSING" -eq 0 ]; then ok "all manifests have type field"; else fail "$MISSING manifest(s) missing type field"; fi

# 7. Premade rooms — verify JSON is valid
echo ""
echo "── Premade rooms JSON ──"
ROOMS_FILE="webview-ui/public/assets/premade-rooms.json"
if node -e "JSON.parse(require('fs').readFileSync('$ROOMS_FILE','utf8'))" 2>/dev/null; then
  COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOMS_FILE','utf8')).length)")
  ok "premade-rooms.json valid ($COUNT rooms)"
else
  fail "premade-rooms.json invalid JSON"
fi

# Summary
echo ""
echo "═══ Results: $PASS passed, $FAIL failed ═══"
[ "$FAIL" -eq 0 ] && echo "✓ All checks passed — safe to deploy" && exit 0
echo "✗ Fix failures before deploying" && exit 1
