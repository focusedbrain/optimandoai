/**
 * Copies node-fetch's transitive deps (whatwg-url, tr46, webidl-conversions)
 * into apps/electron-vite-project/node_modules so electron-builder packages them.
 * Run before electron-builder. Required because electron-builder rejects "from" paths
 * starting with ".." and pnpm keeps these deps under versioned .pnpm folders.
 *
 * Resolves each package via Node's resolver (any whatwg-url@x / pnpm layout), not a
 * hardcoded whatwg-url@5.0.0 path.
 */
const path = require('path')
const fs = require('fs')

const appDir = path.join(__dirname, '..')
const appNodeModules = path.join(appDir, 'node_modules')

const packages = ['whatwg-url', 'tr46', 'webidl-conversions']

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const srcPath = path.join(src, name)
    const destPath = path.join(dest, name)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
  return true
}

/** Search paths so nested deps (e.g. tr46 under whatwg-url) resolve under pnpm. */
function resolveSearchPaths() {
  const dirs = [appDir]
  try {
    const wu = path.dirname(require.resolve('whatwg-url/package.json', { paths: [appDir] }))
    dirs.push(wu)
  } catch {
    /* optional */
  }
  return dirs
}

let copied = 0
const searchPaths = resolveSearchPaths()

for (const pkg of packages) {
  let src = null
  for (const base of searchPaths) {
    try {
      const p = require.resolve(`${pkg}/package.json`, { paths: [base] })
      src = path.dirname(p)
      break
    } catch {
      /* try next */
    }
  }
  if (!src) {
    console.warn('[copy-pnpm-deps] Not found:', pkg)
    continue
  }
  const dest = path.join(appNodeModules, pkg)
  if (copyRecursive(src, dest)) {
    console.log('[copy-pnpm-deps] Copied', pkg, '-> node_modules/' + pkg)
    copied++
  }
}

if (copied > 0) {
  console.log('[copy-pnpm-deps] Ready for electron-builder')
}
