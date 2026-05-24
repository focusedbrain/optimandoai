#!/usr/bin/env bash
# BEAP REMOTE_EDGE pod smoke test — Phase 3 (P3.3)
#
# Usage:
#   bash packages/beap-pod/scripts/remote-edge-smoke.sh [--skip-build]
#
# What it tests (once P3.4 certifier logic lands):
#   1. Builds (or reuses) the beap-components:dev image.
#   2. Generates ephemeral POD_AUTH_SECRET and a test Ed25519 keypair.
#   3. Generates a stub SSO attestation JWT (smoke-only; not Keycloak).
#   4. Installs the certifier seccomp profile.
#   5. Starts the REMOTE_EDGE pod via `podman play kube`.
#   6. Posts a synthetic pBEAP message to /ingest.
#   7. Asserts the response includes an edge certificate whose Ed25519 signature
#      verifies against the test public key, expires_at is in the future, and
#      package_hash matches the posted raw bytes.
#   8. Tears down the pod.
#
# Until P3.4 (certifier /certify HTTP server), step 7 fails with an explicit
# "TODO P3.4" message — that is expected.
#
# Requirements:
#   podman ≥ 4.0, bash, curl, openssl, envsubst, node ≥ 18

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
POD_YAML="$PKG_DIR/pod-remote-edge.yaml"
SECCOMP_SRC="$PKG_DIR/seccomp/certifier.json"
BEAP_CERT_DIR="$REPO_ROOT/packages/beap-cert"

SECCOMP_ROOT="${PODMAN_SECCOMP_ROOT:-${HOME}/.local/share/containers/seccomp}"
POD_NAME="beap-pod-remote-edge"

TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"; smoke_teardown' EXIT INT TERM

log()  { echo "[remote-edge-smoke] $*"; }
pass() { echo "[remote-edge-smoke] PASS: $*"; }
fail() { echo "[remote-edge-smoke] FAIL: $*" >&2; exit 1; }
todo_p34() {
  echo "[remote-edge-smoke] TODO P3.4: expected edge_certificate missing from /ingest response." >&2
  exit 1
}

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *) fail "Unknown argument: $arg" ;;
  esac
done

if [ "$SKIP_BUILD" = false ]; then
  log "Building beap-components:dev from repo root..."
  (cd "$REPO_ROOT" && podman build -t beap-components:dev -f packages/beap-pod/Containerfile .) \
    || fail "Image build failed"
  pass "Image built"
else
  log "Skipping image build (--skip-build)"
fi

log "Building @repo/beap-cert (for certificate verification helper)..."
(cd "$REPO_ROOT" && pnpm --filter @repo/beap-cert build) || fail "@repo/beap-cert build failed"

export POD_AUTH_SECRET
export EDGE_PRIVATE_KEY_HEX
export EDGE_POD_ID
export SSO_ATTESTATION_JWT
export CERT_TTL_SECONDS="${CERT_TTL_SECONDS:-86400}"

POD_AUTH_SECRET="$(openssl rand -hex 32)"

KEYS_JSON="$(cd "$REPO_ROOT" && node --input-type=module <<'EOF'
import { ed25519 } from '@noble/curves/ed25519.js';
import { randomUUID } from 'node:crypto';

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const secretKey = ed25519.utils.randomSecretKey();
const publicKey = ed25519.getPublicKey(secretKey);
const edgePodId = randomUUID();
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(
  JSON.stringify({ sub: 'smoke-test-user', pod_id: edgePodId, iss: 'beap-remote-edge-smoke' }),
).toString('base64url');
const jwt = `${header}.${payload}.smoke-stub-signature-not-keycloak`;

process.stdout.write(
  JSON.stringify({
    EDGE_PRIVATE_KEY_HEX: hex(secretKey),
    EDGE_PUBLIC_KEY_HEX: hex(publicKey),
    EDGE_POD_ID: edgePodId,
    SSO_ATTESTATION_JWT: jwt,
  }),
);
EOF
)"

EDGE_PRIVATE_KEY_HEX="$(echo "$KEYS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).EDGE_PRIVATE_KEY_HEX)")"
EDGE_PUBLIC_KEY_HEX="$(echo "$KEYS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).EDGE_PUBLIC_KEY_HEX)")"
EDGE_POD_ID="$(echo "$KEYS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).EDGE_POD_ID)")"
SSO_ATTESTATION_JWT="$(echo "$KEYS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).SSO_ATTESTATION_JWT)")"

export EDGE_PRIVATE_KEY_HEX EDGE_POD_ID SSO_ATTESTATION_JWT

log "Generated POD_AUTH_SECRET, EDGE_POD_ID=$EDGE_POD_ID, CERT_TTL_SECONDS=$CERT_TTL_SECONDS"

mkdir -p "$SECCOMP_ROOT"
cp "$SECCOMP_SRC" "$SECCOMP_ROOT/beap-certifier.json"
log "Installed certifier seccomp profile → $SECCOMP_ROOT/beap-certifier.json"

smoke_teardown() {
  log "Tearing down pod..."
  podman pod stop "$POD_NAME" 2>/dev/null || true
  podman pod rm   "$POD_NAME" 2>/dev/null || true
  log "Teardown complete"
}

APPLIED_YAML="$TMPDIR_SMOKE/pod-applied.yaml"
envsubst < "$POD_YAML" > "$APPLIED_YAML"

log "Validating manifest (podman play kube --dry-run)..."
podman play kube --dry-run "$APPLIED_YAML" >/dev/null || fail "pod-remote-edge.yaml dry-run failed"

log "Starting REMOTE_EDGE pod..."
podman play kube "$APPLIED_YAML" || fail "podman play kube failed"

log "Waiting for ingestor /health..."
for i in $(seq 1 45); do
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" \
    http://127.0.0.1:18100/health 2>/dev/null || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    pass "Ingestor ready (attempt $i)"
    break
  fi
  if [ "$i" = "45" ]; then
    log "Container logs:"
    podman pod logs --names "$POD_NAME" 2>/dev/null | tail -60 || true
    fail "Ingestor not ready after 45 s (last HTTP code: $HTTP_CODE)"
  fi
  sleep 1
done

log "Building pBEAP wire package for /ingest..."
INGEST_PAYLOAD="$(cd "$REPO_ROOT" && node --input-type=module <<'EOF'
const capsuleJson = JSON.stringify({
  subject: 'remote-edge-smoke',
  body: '<p>Hello REMOTE_EDGE</p>',
  transport_plaintext: '',
});
const payloadB64 = Buffer.from(capsuleJson).toString('base64');
const pkg = {
  header: {
    version: '1.0',
    encoding: 'pBEAP',
    sender_fingerprint: 'remote-edge-smoke-fp',
    template_hash: 'd'.repeat(64),
    policy_hash: 'e'.repeat(64),
    content_hash: 'f'.repeat(64),
  },
  metadata: { created_at: Date.now() },
  payload: payloadB64,
  signature: {
    signature: Buffer.alloc(64).toString('base64'),
    algorithm: 'Ed25519',
    keyId: 'smoke-key',
  },
};
const bodyString = JSON.stringify(pkg);
const dummyKey = Buffer.alloc(32, 1).toString('base64');
process.stdout.write(
  JSON.stringify({
    body: bodyString,
    source_type: 'api',
    mime_type: 'application/json',
    depackage_keys: { x25519_priv_b64: dummyKey },
  }),
);
EOF
)"

RAW_BYTES_FILE="$TMPDIR_SMOKE/pbeap.raw.json"
node -e "const fs=require('fs'); const p=JSON.parse(process.argv[1]); fs.writeFileSync(process.argv[2], p.body);" "$INGEST_PAYLOAD" "$RAW_BYTES_FILE"

RESP_FILE="$TMPDIR_SMOKE/ingest-response.json"
HTTP_CODE="$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$INGEST_PAYLOAD" \
  http://127.0.0.1:18100/ingest 2>/dev/null || echo 000)"
INGEST_RESP="$(cat "$RESP_FILE" 2>/dev/null || echo '')"
log "/ingest HTTP $HTTP_CODE → ${INGEST_RESP:0:400}..."

if [ "$HTTP_CODE" -ge 500 ] 2>/dev/null; then
  log "Container logs:"
  podman pod logs --names "$POD_NAME" 2>/dev/null | tail -60 || true
  fail "/ingest returned 5xx ($HTTP_CODE) — check pod logs"
fi

if ! echo "$INGEST_RESP" | grep -qE '"edge_certificate"|"certificate"'; then
  log "Container logs:"
  podman pod logs --names "$POD_NAME" 2>/dev/null | tail -60 || true
  todo_p34
fi

cat > "$TMPDIR_SMOKE/verify-cert.mjs" <<VERIFYEOF
import { readFileSync } from 'node:fs';
import { verifyCertificate, packageHash } from '${BEAP_CERT_DIR//\\/\/}/dist/index.js';

const resp = JSON.parse(readFileSync('${RESP_FILE//\\/\/}', 'utf8'));
const cert = resp.edge_certificate ?? resp.certificate;
if (!cert) {
  console.error('No edge_certificate in response');
  process.exit(2);
}

const publicKeyHex = '${EDGE_PUBLIC_KEY_HEX}';
const publicKey = Uint8Array.from(publicKeyHex.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
const sig = verifyCertificate(cert, publicKey);
if (!sig.ok) {
  console.error('Signature verification failed:', sig.reason);
  process.exit(3);
}

const rawBytes = readFileSync('${RAW_BYTES_FILE//\\/\/}');
const expectedHash = packageHash(new Uint8Array(rawBytes));
if (cert.package_hash !== expectedHash) {
  console.error('package_hash mismatch:', cert.package_hash, '!=', expectedHash);
  process.exit(4);
}

const expiresAt = Date.parse(cert.expires_at);
if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
  console.error('expires_at not in the future:', cert.expires_at);
  process.exit(5);
}

console.log('certificate OK');
VERIFYEOF

VERIFY_OUT="$(node "$TMPDIR_SMOKE/verify-cert.mjs" 2>&1)" || {
  echo "$VERIFY_OUT" >&2
  if echo "$VERIFY_OUT" | grep -q 'No edge_certificate'; then
    todo_p34
  fi
  fail "Certificate verification failed: $VERIFY_OUT"
}

pass "$VERIFY_OUT"
pass "REMOTE_EDGE smoke complete"
log "Cleaning up..."
