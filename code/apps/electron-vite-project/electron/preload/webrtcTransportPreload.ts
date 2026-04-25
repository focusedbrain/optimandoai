/**
 * Preload for the hidden internal-inference P2P WebRTC page only.
 * Exposes a narrow channel to main: no Ollama, no secrets, do not log SDP/ICE in production.
 */
import { contextBridge, ipcRenderer } from 'electron'

const FROM_MAIN = 'p2p-webrtc:from-main'
const TO_MAIN = 'p2p-webrtc:to-main'

const api = {
  onFromMain(handler: (msg: unknown) => void) {
    const w = (_e: Electron.IpcRendererEvent, msg: unknown) => {
      try {
        handler(msg)
      } catch {
        /* main gates validation */
      }
    }
    ipcRenderer.on(FROM_MAIN, w)
    return () => {
      ipcRenderer.removeListener(FROM_MAIN, w)
    }
  },
  toMain(msg: unknown) {
    ipcRenderer.send(TO_MAIN, msg)
  },
} as const

contextBridge.exposeInMainWorld('wrdeskWebrtcP2p', api)

export type WrdeskWebrtcP2p = typeof api
