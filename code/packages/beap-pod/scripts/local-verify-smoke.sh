#!/usr/bin/env bash
# BEAP LOCAL_VERIFY pod smoke test — Phase 3 (P3.5)
#
# Usage:
#   bash packages/beap-pod/scripts/local-verify-smoke.sh [--skip-build]
#
# What it tests (once P3.6 verifier logic lands):
#   1. Builds (or reuses) beap-components:dev.
#   2. Generates POD_AUTH_SECRET, SEAL_KEY_HEX, test JWKS, LOCAL_SSO_SUB.
#   3. Mints a test edge certificate (same @repo/beap-cert paths as the edge certifier).
#   4. Starts the LOCAL_VERIFY pod with preloaded JWKS (no verifier egress).
#   5. Posts (message + edge_certificate) to /ingest — expects sealed payload.
#   6. Negative: tampered certificate → verification failure, no seal.
#
# Until P3.6 (verifier /verify-cert HTTP server), steps 5–6 fail with TODO P3.6.
#
# Requirements:
#   podman ≥ 4.0, bash, curl, openssl, envsubst, node ≥ 18

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
POD_YAML="$PKG_DIR/pod-local-verify.yaml"
SECCOMP_SRC="$PKG_DIR/seccomp/sealer.json"

SECCOMP_ROOT="${PODMAN_SECCOMP_ROOT:-${HOME}/.local/share/containers/seccomp}"
POD_NAME="beap-pod-local-verify"

TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"; smoke_teardown' EXIT INT TERM

log()  { echo "[local-verify-smoke] $*"; }
pass() { echo "[local-verify-smoke] PASS: $*"; }
fail() { echo "[local-verify-smoke] FAIL: $*" >&2; exit 1; }
todo_p36() {
  echo "[local-verify-smoke] TODO P3.6: verifier /verify-cert not implemented yet — expected until P3.6 lands." >&2
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
  log "Building beap-components:dev..."
  (cd "$REPO_ROOT" && podman build -t beap-components:dev -f packages/beap-pod/Containerfile .) \
    || fail "Image build failed"
  pass "Image built"
else
  log "Skipping image build (--skip-build)"
fi

log "Building @repo/beap-cert..."
(cd "$REPO_ROOT" && pnpm --filter @repo/beap-cert build) || fail "@repo/beap-cert build failed"

export POD_AUTH_SECRET
export SEAL_KEY_HEX
export LOCAL_SSO_SUB
export TRUSTED_EDGE_POD_IDS

POD_AUTH_SECRET="$(openssl rand -hex 32)"
SEAL_KEY_HEX="$(openssl rand -hex 32)"

SMOKE_ARTIFACTS="$TMPDIR_SMOKE/artifacts.json"
(cd "$REPO_ROOT" && node --input-type=module <<'EOF' > "$SMOKE_ARTIFACTS"
import { createHmac, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  capsuleCanonicalHash,
  packageHash,
  signCertificate,
  validationResultDigest,
} from '@repo/beap-cert';

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const localSsoSub = 'smoke-local-verify-user';
const edgePodId = randomUUID();
const edgeSecretKey = ed25519.utils.randomSecretKey();

const jwksKeyBytes = Buffer.alloc(32, 7);
const jwksKeyB64 = jwksKeyBytes.toString('base64url');
const jwks = {
  keys: [
    {
      kty: 'oct',
      alg: 'HS256',
      use: 'sig',
      kid: 'smoke-hs256',
      k: jwksKeyB64,
    },
  ],
};

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'smoke-hs256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', jwksKeyBytes).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const ssoAttestation = signJwt({ sub: localSsoSub, pod_id: edgePodId, iss: 'beap-local-verify-smoke' });

const capsuleJson = JSON.stringify({
  subject: 'local-verify-smoke',
  body: '<p>Hello LOCAL_VERIFY</p>',
  transport_plaintext: '',
});
const payloadB64 = Buffer.from(capsuleJson).toString('base64');
const pkg = {
  header: {
    version: '1.0',
    encoding: 'pBEAP',
    sender_fingerprint: 'local-verify-smoke-fp',
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
const rawPackageBytes = Buffer.from(bodyString, 'utf8');
const canonicalCapsuleBytes = Buffer.from(JSON.stringify(pkg), 'utf8');
const canonicalValidationResultBytes = Buffer.from(JSON.stringify({ valid: true, smoke: true }), 'utf8');

const now = new Date();
const unsigned = {
  v: 1,
  package_hash: packageHash(new Uint8Array(rawPackageBytes)),
  capsule_canonical_hash: capsuleCanonicalHash(new Uint8Array(canonicalCapsuleBytes)),
  validation_result_digest: validationResultDigest(new Uint8Array(canonicalValidationResultBytes)),
  edge_pod_id: edgePodId,
  issued_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 86400_000).toISOString(),
  sso_attestation: ssoAttestation,
};

const edgeCertificate = signCertificate(unsigned, edgeSecretKey);

process.stdout.write(
  JSON.stringify({
    LOCAL_SSO_SUB: localSsoSub,
    TRUSTED_EDGE_POD_IDS: edgePodId,
    KEYCLOAK_JWKS_JSON: JSON.stringify(jwks),
    ingestBody: bodyString,
    edgeCertificate,
    ingestEnvelope: {
      body: bodyString,
      source_type: 'api',
      mime_type: 'application/json',
      edge_certificate: edgeCertificate,
      depackage_keys: { x25519_priv_b64: Buffer.alloc(32, 1).toString('base64') },
    },
  }),
);
EOF
)

LOCAL_SSO_SUB="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).LOCAL_SSO_SUB)" "$SMOKE_ARTIFACTS")"
TRUSTED_EDGE_POD_IDS="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).TRUSTED_EDGE_POD_IDS)" "$SMOKE_ARTIFACTS")"
KEYCLOAK_JWKS_JSON="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).KEYCLOAK_JWKS_JSON)" "$SMOKE_ARTIFACTS")"

export LOCAL_SSO_SUB TRUSTED_EDGE_POD_IDS

mkdir -p "$SECCOMP_ROOT"
cp "$SECCOMP_SRC" "$SECCOMP_ROOT/beap-sealer.json"
log "Installed sealer seccomp profile → $SECCOMP_ROOT/beap-sealer.json"

smoke_teardown() {
  log "Tearing down pod..."
  podman pod stop "$POD_NAME" 2>/dev/null || true
  podman pod rm   "$POD_NAME" 2>/dev/null || true
}

APPLIED_YAML="$TMPDIR_SMOKE/pod-applied.yaml"
envsubst '${POD_AUTH_SECRET} ${SEAL_KEY_HEX} ${LOCAL_SSO_SUB} ${TRUSTED_EDGE_POD_IDS}' < "$POD_YAML" > "$APPLIED_YAML"

node -e "
const fs = require('fs');
const jwks = process.argv[1];
const path = process.argv[2];
let yaml = fs.readFileSync(path, 'utf8');
yaml = yaml.replace('__KEYCLOAK_JWKS_JSON__', jwks.replace(/\"/g, '\\\\\"'));
fs.writeFileSync(path, yaml);
" "$KEYCLOAK_JWKS_JSON" "$APPLIED_YAML"

log "Validating manifest (podman play kube --dry-run)..."
podman play kube --dry-run "$APPLIED_YAML" >/dev/null || fail "pod-local-verify.yaml dry-run failed"

log "Starting LOCAL_VERIFY pod..."
podman play kube "$APPLIED_YAML" || fail "podman play kube failed"

log "Waiting for ingestor /health..."
for i in $(seq 1 60); do
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" \
    http://127.0.0.1:18100/health 2>/dev/null || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    pass "Ingestor ready (attempt $i)"
    break
  fi
  if [ "$i" = "60" ]; then
    podman pod logs --names "$POD_NAME" 2>/dev/null | tail -80 || true
    fail "Ingestor not ready after 60 s (last HTTP code: $HTTP_CODE)"
  fi
  sleep 1
done

INGEST_PAYLOAD="$TMPDIR_SMOKE/ingest-positive.json"
node -e "
const fs=require('fs');
const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
fs.writeFileSync(process.argv[2], JSON.stringify(a.ingestEnvelope));
" "$SMOKE_ARTIFACTS" "$INGEST_PAYLOAD"

RESP_FILE="$TMPDIR_SMOKE/ingest-positive-response.json"
HTTP_CODE="$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @"$INGEST_PAYLOAD" \
  http://127.0.0.1:18100/ingest 2>/dev/null || echo 000)"
INGEST_RESP="$(cat "$RESP_FILE" 2>/dev/null || echo '')"
log "Positive /ingest HTTP $HTTP_CODE → ${INGEST_RESP:0:400}..."

if [ "$HTTP_CODE" -ge 500 ] 2>/dev/null; then
  podman pod logs --names "$POD_NAME" 2>/dev/null | tail -80 || true
  fail "Positive /ingest returned 5xx ($HTTP_CODE)"
fi

if ! echo "$INGEST_RESP" | grep -q '"seal"'; then
  podman pod logs --names "$POD_NAME" 2>/dev/null | tail -80 || true
  todo_p36
fi

pass "Positive path returned sealed payload"

TAMPERED_PAYLOAD="$TMPDIR_SMOKE/ingest-tampered.json"
node -e "
const fs=require('fs');
const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const cert={...a.edgeCertificate, package_hash:'sha256:'+'0'.repeat(64)};
const env={...a.ingestEnvelope, edge_certificate:cert};
fs.writeFileSync(process.argv[2], JSON.stringify(env));
" "$SMOKE_ARTIFACTS" "$TAMPERED_PAYLOAD"

RESP_TAMPER="$TMPDIR_SMOKE/ingest-tampered-response.json"
HTTP_TAMPER="$(curl -s -o "$RESP_TAMPER" -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @"$TAMPERED_PAYLOAD" \
  http://127.0.0.1:18100/ingest 2>/dev/null || echo 000)"
TAMPER_RESP="$(cat "$RESP_TAMPER" 2>/dev/null || echo '')"
log "Tampered /ingest HTTP $HTTP_TAMPER → ${TAMPER_RESP:0:300}..."

if echo "$TAMPER_RESP" | grep -q '"seal"'; then
  fail "Tampered certificate must not produce a seal"
fi

if [ "$HTTP_TAMPER" = "200" ] && ! echo "$TAMPER_RESP" | grep -qiE 'verif|reject|cert|unauthor'; then
  todo_p36
fi

pass "Tampered certificate rejected (no seal)"
pass "LOCAL_VERIFY smoke complete"
log "Cleaning up..."
