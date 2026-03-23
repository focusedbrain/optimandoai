/**
 * Copies node-fetch's transitive deps (whatwg-url, tr46, webidl-conversions)
 * from the pnpm store into the app's node_modules so electron-builder packages them.
 * Run before electron-builder. Required because electron-builder rejects "from" paths
 * starting with ".." and pnpm keeps these deps in .pnpm only.
 */
const path = require('path')
const fs = require('fs')

const appDir = path.join(__dirname, '..')
const rootNodeModules = path.join(appDir, '../../node_modules')
const pnpmStore = path.join(rootNodeModules, '.pnpm', 'whatwg-url@5.0.0', 'node_modules')
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

let copied = 0
for (const pkg of packages) {
  const src = path.join(pnpmStore, pkg)
  const dest = path.join(appNodeModules, pkg)
  if (copyRecursive(src, dest)) {
    console.log('[copy-pnpm-deps] Copied', pkg, '-> node_modules/' + pkg)
    copied++
  } else {
    console.warn('[copy-pnpm-deps] Not found:', src)
  }
}

if (copied > 0) {
  console.log('[copy-pnpm-deps] Ready for electron-builder')
}
