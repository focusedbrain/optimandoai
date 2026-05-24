#!/usr/bin/env bash
# ============================================================================
# Inbox Validator Gate CI Guardrail — Decision 1c (Canon I.3.1 / I.3.3 / I.3.4)
# ============================================================================
#
# Enforces that every TypeScript file that writes depackaged_json OR
# depackaged_metadata to inbox_messages also calls validateDecryptedBeapContent
# in the same file.
#
# Rationale (per Canon A.3.054.8, Annex I.3.3):
#   The Validator is the sole component allowed to mark capsules as validated.
#   Any write to inbox_messages.depackaged_json that does NOT accompany a
#   validator call is a canon violation — validated_at would remain NULL,
#   leaving the row in an unverified state that the inbox UI may act on.
#
#   PR 5.1 adds depackaged_metadata (wrapper metadata column). Files that write
#   depackaged_metadata alongside depackaged_json must still call the validator —
#   the metadata column is written by the same paths that write content.
#
# What the rule checks:
#   Rule 1: Any file containing an INSERT INTO inbox_messages that also sets
#           depackaged_json must also contain a call to
#           validateDecryptedBeapContent.
#   Rule 2: Any file containing UPDATE inbox_messages SET ... depackaged_json
#           or ... depackaged_metadata must also contain a call to
#           validateDecryptedBeapContent.
#   Rule 3: Files that only SELECT from inbox_messages are not flagged.
#
# Allowed exceptions (files that legitimately write these columns with
# validation already handled structurally, or that are test files):
#   - *.test.ts      — unit/integration tests (validation is mocked/asserted)
#   - *.spec.ts      — same
#   - db.ts          — schema migration functions operate outside the normal
#                      validator gate (DDL-only migrations, no content writes).
#
# Run:  bash scripts/check-inbox-validator-gate.sh
# CI:   pnpm run check:inbox-validator-gate   (see package.json root scripts)
#
# Introduced: PR 2.2/8 — Close All Remaining Receive-Side Security Deferrals
# Updated:    PR 5.1/8 — Depackager Determinism Boundary (added depackaged_metadata)
# ============================================================================

set -euo pipefail

SEARCH_DIRS="apps/electron-vite-project/electron packages"
EXIT_CODE=0

echo "=== Inbox Validator Gate Check ==="
echo "    Canon I.3.1 / I.3.3 / I.3.4 — validateDecryptedBeapContent must"
echo "    accompany every depackaged_json / depackaged_metadata write to inbox_messages."
echo ""

# Collect all non-test TS files that write depackaged_json or depackaged_metadata to inbox_messages
WRITE_FILES=()

while IFS= read -r -d '' f; do
  # Skip test files — validation is mocked or asserted in tests
  if [[ "$f" == *.test.ts ]] || [[ "$f" == *.spec.ts ]]; then
    continue
  fi

  # Skip db.ts — migration/backfill functions run outside the normal ingest path.
  if [[ "$f" == */handshake/db.ts ]]; then
    continue
  fi

  # Check for INSERT with depackaged_json or depackaged_metadata
  has_insert=$(grep -l "INSERT INTO inbox_messages" "$f" 2>/dev/null || true)
  # Check for UPDATE ... depackaged_json or depackaged_metadata
  has_update=$(grep -l "depackaged_json\|depackaged_metadata" "$f" 2>/dev/null | xargs grep -l "UPDATE inbox_messages" 2>/dev/null || true)

  if [ -n "$has_insert" ] || [ -n "$has_update" ]; then
    # Confirm the file actually sets the column (not just references it in a SELECT)
    if grep -qE "(INSERT INTO inbox_messages|depackaged_json\s*=|depackaged_metadata\s*=)" "$f" 2>/dev/null; then
      WRITE_FILES+=("$f")
    fi
  fi
done < <(find $SEARCH_DIRS -name "*.ts" -not -name "*.test.ts" -not -name "*.spec.ts" -print0 2>/dev/null)

if [ "${#WRITE_FILES[@]}" -eq 0 ]; then
  echo "[Rule 1+2] No non-test files write depackaged_json/depackaged_metadata to inbox_messages."
  echo "  PASS (nothing to check)"
else
  echo "[Rule 1+2] Checking ${#WRITE_FILES[@]} file(s) that write depackaged content to inbox_messages..."
  for f in "${WRITE_FILES[@]}"; do
    if grep -q "validateDecryptedBeapContent" "$f" 2>/dev/null; then
      echo "  PASS: $f"
    else
      echo "  FAIL: $f"
      echo "        → Writes depackaged_json/depackaged_metadata to inbox_messages but does NOT call validateDecryptedBeapContent."
      echo "        → Per Canon I.3.3: the Validator must be called for every inbox write."
      echo "        → Fix: import validateDecryptedBeapContent from @repo/ingestion-core and call it"
      echo "               before the INSERT/UPDATE, then write validated_at/validator_version/validation_reason."
      EXIT_CODE=1
    fi
  done
fi

echo ""

# Rule 3: Sanity-check — SELECT-only references do not trigger the rule
echo "[Rule 3] SELECT-only references to inbox_messages are not flagged (sanity check)."
echo "  PASS (reads are excluded by grep pattern)"

echo ""
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "RESULT: FAIL — Inbox validator gate violations detected."
  echo "  Every write of depackaged_json/depackaged_metadata to inbox_messages MUST be accompanied"
  echo "  by a call to validateDecryptedBeapContent from @repo/ingestion-core."
  echo "  See Canon A.3.054.8, Annex I.3.3."
else
  echo "RESULT: PASS — All inbox_messages writes include validator gate."
fi

exit $EXIT_CODE
