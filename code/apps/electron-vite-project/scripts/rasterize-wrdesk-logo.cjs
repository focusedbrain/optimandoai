/**
 * Rasterize public/wrdesk-logo.svg -> wrdesk-logo.png for Electron (tray/window/OAuth loopback).
 * Extension MV3 also uses PNG for <img> + manifest web_accessible_resources.
 *
 * Run from apps/electron-vite-project: node scripts/rasterize-wrdesk-logo.cjs
 */
const fs = require('fs')
const path = require('path')
const { createCanvas, loadImage } = require('canvas')

async function main() {
  const pub = path.join(__dirname, '..', 'public')
  const svgPath = path.join(pub, 'wrdesk-logo.svg')
  const outElectron = path.join(pub, 'wrdesk-logo.png')
  const extPub = path.join(__dirname, '..', '..', 'extension-chromium', 'public', 'wrdesk-logo.png')

  if (!fs.existsSync(svgPath)) {
    console.error('[rasterize-wrdesk-logo] Missing:', svgPath)
    process.exit(1)
  }

  const img = await loadImage(svgPath)
  const w = img.width || 256
  const h = img.height || 256
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0)

  const buf = canvas.toBuffer('image/png')
  fs.writeFileSync(outElectron, buf)
  console.log('[rasterize-wrdesk-logo] Wrote', outElectron, `(${buf.length} bytes)`)

  fs.mkdirSync(path.dirname(extPub), { recursive: true })
  fs.writeFileSync(extPub, buf)
  console.log('[rasterize-wrdesk-logo] Wrote', extPub)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
