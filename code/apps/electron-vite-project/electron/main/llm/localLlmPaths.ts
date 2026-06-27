/**
 * Managed GGUF model directory for llama.cpp (Phase 2 install UI writes here).
 * Default: `<Electron userData>/models` (e.g. `%APPDATA%/WR Desk/models` on Windows).
 */

import path from 'path'
import { app } from 'electron'

/** Default llama-server loopback port (OpenAI-compatible API). */
export const DEFAULT_LLAMACPP_PORT = 8080

export const HOST_AI_DEFAULT_LOCAL_LLAMACPP_BASE = `http://127.0.0.1:${DEFAULT_LLAMACPP_PORT}`

export function getLocalLlmModelsDirectory(): string {
  return path.join(app.getPath('userData'), 'models')
}
