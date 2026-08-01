/**
 * Renderer → main Art. 50 IPC (editorial logging). Generation stays in attachProvenance.
 */

import { ipcMain } from 'electron'
import {
  isAiProvenance,
  markEditorialResponsible,
  type AiProvenance,
} from '../../../../../packages/shared/src/aiProvenance'
import { logEditorialResponsibility } from './provenanceLog'

let registered = false

export function registerArt50Ipc(): void {
  if (registered) return
  registered = true

  ipcMain.handle(
    'art50:logEditorialResponsibility',
    async (_e, raw: unknown): Promise<{ ok: true; provenance: AiProvenance } | { ok: false; error: string }> => {
      if (!isAiProvenance(raw)) {
        return { ok: false, error: 'invalid_provenance' }
      }
      const next = markEditorialResponsible(raw)
      logEditorialResponsibility(next)
      return { ok: true, provenance: next }
    },
  )
}
