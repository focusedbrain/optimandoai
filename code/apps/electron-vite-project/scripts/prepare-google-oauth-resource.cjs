/**
 * Before `vite build`, optionally writes resources/google-oauth-client-id.txt from env.
 * Release pipelines should set GOOGLE_OAUTH_CLIENT_ID (or WR_DESK_GOOGLE_OAUTH_CLIENT_ID).
 *
 * If WR_DESK_REQUIRE_GOOGLE_OAUTH_CLIENT_ID=1 or CI=true, fails when env is missing and
 * the on-disk file still contains a placeholder (REPLACE_WITH / YOUR_ / etc.).
 */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const target = path.join(root, 'resources', 'google-oauth-client-id.txt')

function firstDataLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
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

const envId = (process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID || '').trim()
const strict =
  process.env.WR_DESK_REQUIRE_GOOGLE_OAUTH_CLIENT_ID === '1' ||
  process.env.CI === 'true' ||
  process.env.GITHUB_ACTIONS === 'true'

if (envId) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${envId}\n`, 'utf8')
  console.log('[prepare-google-oauth] Wrote resources/google-oauth-client-id.txt from environment')
} else if (strict && fs.existsSync(target)) {
  const line = firstDataLine(fs.readFileSync(target, 'utf8'))
  if (isPlaceholderLine(line)) {
    console.error(
      '[prepare-google-oauth] FATAL: GOOGLE_OAUTH_CLIENT_ID is not set and resources/google-oauth-client-id.txt still contains a placeholder. Release builds must inject a real Google OAuth client id.',
    )
    process.exit(1)
  }
  console.log('[prepare-google-oauth] Using existing resources/google-oauth-client-id.txt (non-placeholder)')
} else {
  console.log('[prepare-google-oauth] Skipped (no env); placeholder file is OK for local dev')
}
