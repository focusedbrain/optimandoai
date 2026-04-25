/**
 * Owns the single hidden BrowserWindow for internal-inference WebRTC.
 * All RTCPeerConnection / RTCDataChannel exist only in that renderer, never in the main app window.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { getP2pTransportPagePath } from '../../platform'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'

const VITE = process.env['VITE_DEV_SERVER_URL']
const mainOutDir = path.dirname(fileURLToPath(import.meta.url))

let transportWin: BrowserWindow | null = null
let createPromise: Promise<BrowserWindow> | null = null

/** Built next to the main process bundle (same `dist-electron` folder as `preload.cjs`). */
export function getWebrtcTransportPreloadPath(): string {
  return path.join(mainOutDir, 'webrtc-transport.cjs')
}

function getTransportFilePathForProd(): string {
  const ap = process.env.APP_ROOT ?? ''
  const rd = ap ? path.join(ap, 'dist') : path.join(mainOutDir, '..', 'dist')
  return getP2pTransportPagePath(mainOutDir, rd, app.isPackaged)
}

function getTransportLoadUrlOrPath(): { url: string } | { file: string } {
  if (VITE) {
    const base = VITE.replace(/\/$/, '')
    return { url: `${base}/src/internal-inference-p2p-transport.html` }
  }
  return { file: getTransportFilePathForProd() }
}

/**
 * @returns the hidden window that owns the WebRTC stack (lazily created when WebRTC is enabled).
 */
export async function ensureWebrtcTransportWindow(): Promise<BrowserWindow> {
  if (transportWin && !transportWin.isDestroyed()) {
    return transportWin
  }
  if (createPromise) {
    return createPromise
  }
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    throw new Error('WebRTC P2P transport is disabled (WRDESK_P2P_INFERENCE_WEBRTC_ENABLED=0)')
  }
  const preload = getWebrtcTransportPreloadPath()
  createPromise = (async () => {
    const w = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload,
      },
    })
    w.on('closed', () => {
      transportWin = null
    })
    const l = getTransportLoadUrlOrPath()
    if ('url' in l) {
      await w.loadURL(l.url)
    } else {
      await w.loadFile(l.file)
    }
    if (VITE && !app.isPackaged && process.env['WRDESK_P2P_OPEN_TRANSPORT_DEVTOOLS'] === '1') {
      w.webContents.openDevTools({ mode: 'detach' })
    }
    transportWin = w
    return w
  })()
  try {
    return await createPromise
  } finally {
    createPromise = null
  }
}

export function getWebrtcTransportWindowOrNull(): BrowserWindow | null {
  if (transportWin && !transportWin.isDestroyed()) {
    return transportWin
  }
  return null
}

export function getWebrtcTransportWebContentsIdOrNull(): number | null {
  const w = getWebrtcTransportWindowOrNull()
  if (!w) {
    return null
  }
  return w.webContents.id
}
