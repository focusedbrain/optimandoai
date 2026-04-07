/**
 * Runs before `vite build` / electron-builder (see package.json `build`, `rebuild`, etc.).
 * Ensures gitignored `resources/google-oauth-client-*.txt` exist with real values for packaging via extraResources.
 *
 * Client id: env overwrites file when set; in strict CI, placeholder on-disk id fails.
 * Client secret: if `resources/google-oauth-client-secret.txt` already has a non-placeholder value, leave it;
 *   otherwise write from GOOGLE_OAUTH_CLIENT_SECRET or WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET;
 *   if still missing, exit with a clear error (so GitHub never needs secrets in source).
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
    lower.includes('paste_')
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
  console.error(
    'Build failed: Google OAuth client secret not found. Place it in resources/google-oauth-client-secret.txt or set GOOGLE_OAUTH_CLIENT_SECRET env var.',
  )
  process.exit(1)
}

if (strict && fs.existsSync(targetId) && fs.existsSync(targetSecret)) {
  const idLine = firstDataLine(fs.readFileSync(targetId, 'utf8'))
  const secLine = firstDataLine(fs.readFileSync(targetSecret, 'utf8'))
  if (!isPlaceholderLine(idLine) && isPlaceholderSecretLine(secLine)) {
    console.error(
      '[prepare-google-oauth] FATAL: Valid Google OAuth client id but client secret is missing or placeholder. Set GOOGLE_OAUTH_CLIENT_SECRET (or WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET).',
    )
    process.exit(1)
  }
}
