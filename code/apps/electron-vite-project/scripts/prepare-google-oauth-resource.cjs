/**
 * Runs before `vite build` / electron-builder (see package.json `build`, `rebuild`, etc.).
 * Ensures gitignored `resources/google-oauth-client-*.txt` can exist with real values for packaging via extraResources.
 *
 * Client id: env overwrites file when set; in strict CI, placeholder on-disk id fails.
 * Client secret: OPTIONAL at build time — missing secret warns only (never exits). Builds succeed without
 * `resources/google-oauth-client-secret.txt` / GOOGLE_OAUTH_CLIENT_SECRET; end users may supply the Desktop pairing secret at runtime (encrypted local storage).
 */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const targetId = path.join(root, 'resources', 'google-oauth-client-id.txt')
const targetSecret = path.join(root, 'resources', 'google-oauth-client-secret.txt')

function firstDataLine(text) {
  for (const line of text.split(/\r?\n/)) {
    let t = line.trim().replace(/^\uFEFF/, '')
    if (!t || t.startsWith('#')) continue
    return t
  }
  return ''
}

function isPlaceholderLine(line) {
  if (!line || !line.endsWith('.apps.googleusercontent.com')) return true
  const lower = line.toLowerCase()
  return (
    lower.includes('replace_with') ||
    lower.includes('your_client') ||
    lower.includes('placeholder') ||
    lower.startsWith('unconfigured') ||
    lower.includes('paste_')
  )
}

function isPlaceholderSecretLine(line) {
  if (!line || line.length < 10) return true
  const lower = line.toLowerCase()
  return (
    lower.includes('replace_with') ||
    lower.includes('your_secret') ||
    lower.includes('placeholder') ||
    lower.startsWith('unconfigured') ||
    lower.includes('paste_') ||
    lower.includes('localdevbypass')
  )
}

function oauthClientIdFingerprint(id) {
  const t = String(id).trim()
  if (!t) return '(empty)'
  if (t.length <= 20) return `${t.slice(0, 6)}…(${t.length}ch)`
  return `${t.slice(0, 12)}…${t.slice(-8)}`
}

const envId = (process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID || '').trim()
const envSecret = (
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET || ''
).trim()
const strict =
  process.env.WR_DESK_REQUIRE_GOOGLE_OAUTH_CLIENT_ID === '1' ||
  process.env.CI === 'true' ||
  process.env.GITHUB_ACTIONS === 'true'

if (envId) {
  fs.mkdirSync(path.dirname(targetId), { recursive: true })
  fs.writeFileSync(targetId, `${envId}\n`, 'utf8')
  console.log(
    '[prepare-google-oauth] Wrote resources/google-oauth-client-id.txt from environment; client_id fingerprint:',
    oauthClientIdFingerprint(envId),
  )
} else if (strict && fs.existsSync(targetId)) {
  const line = firstDataLine(fs.readFileSync(targetId, 'utf8'))
  if (isPlaceholderLine(line)) {
    console.error(
      '[prepare-google-oauth] FATAL: GOOGLE_OAUTH_CLIENT_ID is not set and resources/google-oauth-client-id.txt still contains a placeholder. Release builds must inject a real Google OAuth client id.',
    )
    process.exit(1)
  }
  console.log(
    '[prepare-google-oauth] Using existing resources/google-oauth-client-id.txt (non-placeholder); fingerprint:',
    oauthClientIdFingerprint(line),
  )
} else {
  console.log('[prepare-google-oauth] Skipped client id (no env); on-disk file used if present')
}

let secretReady = false
if (fs.existsSync(targetSecret)) {
  const secLine = firstDataLine(fs.readFileSync(targetSecret, 'utf8'))
  if (!isPlaceholderSecretLine(secLine)) {
    secretReady = true
    console.log('[prepare-google-oauth] Using existing resources/google-oauth-client-secret.txt (non-placeholder)')
  }
}

if (!secretReady && envSecret) {
  fs.mkdirSync(path.dirname(targetSecret), { recursive: true })
  fs.writeFileSync(targetSecret, `${envSecret}\n`, 'utf8')
  secretReady = true
  console.log('[prepare-google-oauth] Wrote resources/google-oauth-client-secret.txt from environment')
}

if (!secretReady) {
  console.warn(
    '[prepare-google-oauth] Google OAuth client secret will not be embedded for this build (no env var and no valid resources/google-oauth-client-secret.txt). ' +
      'Build continues; end users can paste the Desktop pairing secret in-app (stored encrypted locally, not bundled).',
  )
}

if (strict && fs.existsSync(targetId)) {
  const idLine = firstDataLine(fs.readFileSync(targetId, 'utf8'))
  const secExists = fs.existsSync(targetSecret)
  const secLine = secExists ? firstDataLine(fs.readFileSync(targetSecret, 'utf8')) : ''
  if (!isPlaceholderLine(idLine) && (!secExists || isPlaceholderSecretLine(secLine))) {
    console.warn(
      '[prepare-google-oauth] Packaging note: valid OAuth client id on disk but client secret missing or placeholder. ' +
        'CI may set WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET, or rely on per-machine Integrations setup.',
    )
  }
}
