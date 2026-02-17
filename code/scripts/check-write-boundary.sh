#!/usr/bin/env bash
# ============================================================================
# Write Boundary CI Guardrail
# ============================================================================
#
# Enforces that setValueSafely is never imported outside the two allowed files:
#   1. committer.ts       — defines it
#   2. inlinePopover.ts   — uses it for click-to-fill (isTrusted path)
#   3. *.test.ts          — unit tests (mock setup)
#
# Also enforces that no file outside the vault/autofill directory imports
# setValueSafely from the barrel index.
#
# Run: bash scripts/check-write-boundary.sh
# CI:  npm run check:write-boundary
# ============================================================================

set -euo pipefail

AUTOFILL_DIR="apps/extension-chromium/src/vault/autofill"
EXIT_CODE=0

echo "=== Write Boundary Check ==="
echo ""

# ── Rule 1: setValueSafely must not be imported outside allowed files ──
echo "[Rule 1] setValueSafely imports restricted to committer.ts, inlinePopover.ts, *.test.ts"

VIOLATIONS=$(grep -rn "import.*setValueSafely" "$AUTOFILL_DIR" \
  --include="*.ts" --include="*.tsx" \
  | grep -v "committer\.ts:" \
  | grep -v "inlinePopover\.ts:" \
  | grep -v "\.test\.ts:" \
  | grep -v "writeBoundary\.ts:" \
  | grep -v "//.*setValueSafely" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "  FAIL: Forbidden import of setValueSafely found:"
  echo "$VIOLATIONS" | while IFS= read -r line; do echo "    $line"; done
  EXIT_CODE=1
else
  echo "  PASS"
fi

# ── Rule 2: setValueSafely must not be re-exported from index.ts ──
echo "[Rule 2] setValueSafely must not appear in barrel export (index.ts)"

BARREL_VIOLATIONS=$(grep -n "export.*setValueSafely" "$AUTOFILL_DIR/index.ts" \
  | grep -v "^.*//.*" \
  || true)

if [ -n "$BARREL_VIOLATIONS" ]; then
  echo "  FAIL: setValueSafely exported from barrel:"
  echo "    $BARREL_VIOLATIONS"
  EXIT_CODE=1
else
  echo "  PASS"
fi

# ── Rule 3: No file outside vault/autofill imports setValueSafely ──
echo "[Rule 3] setValueSafely must not be imported outside vault/autofill/"

EXTERNAL_VIOLATIONS=$(grep -rn "import.*setValueSafely" "apps/extension-chromium/src" \
  --include="*.ts" --include="*.tsx" \
  | grep -v "vault/autofill/" \
  || true)

if [ -n "$EXTERNAL_VIOLATIONS" ]; then
  echo "  FAIL: External import of setValueSafely:"
  echo "$EXTERNAL_VIOLATIONS" | while IFS= read -r line; do echo "    $line"; done
  EXIT_CODE=1
else
  echo "  PASS"
fi

# ── Rule 4: commitInsert must only be called from tests or overlay consent path ──
echo "[Rule 4] commitInsert() calls restricted (production code: only overlay consent resolution)"

COMMIT_CALLS=$(grep -rn "commitInsert(" "$AUTOFILL_DIR" \
  --include="*.ts" --include="*.tsx" \
  | grep -v "\.test\.ts:" \
  | grep -v "\.spec\.ts:" \
  | grep -v "committer\.ts:" \
  | grep -v "writeBoundary\.ts:" \
  | grep -v "//.*commitInsert" \
  | grep -v "export.*commitInsert" \
  | grep -v "'commitInsert'" \
  | grep -v "\"commitInsert\"" \
  || true)

if [ -n "$COMMIT_CALLS" ]; then
  echo "  WARN: commitInsert() called in production code (verify it's in overlay consent path):"
  echo "$COMMIT_CALLS" | while IFS= read -r line; do echo "    $line"; done
  echo "  (This is a warning, not a failure — manual review required)"
else
  echo "  PASS"
fi

echo ""
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "RESULT: FAIL — Write boundary violations detected."
  echo "  Fix: Use commitInsert() (via writeBoundary) or the inlinePopover path."
  echo "  Do NOT import setValueSafely directly."
else
  echo "RESULT: PASS — All write boundary rules satisfied."
fi

exit $EXIT_CODE
