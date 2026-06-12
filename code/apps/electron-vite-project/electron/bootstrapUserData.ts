/**
 * WR Desk Electron userData bootstrap — MUST be the first import of `electron/main.ts`.
 *
 * ## Invariant (do not violate)
 * No production module may call `app.getPath('userData')` (or persist paths derived from it)
 * at **module top-level / import time**. Custom userData (`~/.opengiraffe/electron-data`) is
 * only valid **after** this file runs. Eager singletons (e.g. `emailGateway`) load accounts in
 * their constructor; if they import before this bootstrap, accounts rehydrate from the wrong path.
 *
 * Safe patterns: lazy getters (`function storePath() { return app.getPath('userData') }`),
 * or reads inside IPC handlers / `app.whenReady()` after this bootstrap.
 *
 * Import `userDataBootstrapState` (not this file) from persistence modules that need the flag.
 *
 * @see `electron/main/email/__tests__/userDataBootstrapPersistence.test.ts`
 */

import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { markUserDataPathBootstrapped } from './userDataBootstrapState'

/** Canonical WR Desk userData directory (also used by scripts and docs). */
export function getWrDeskUserDataPath(): string {
  return path.join(os.homedir(), '.opengiraffe', 'electron-data')
}

// Fix Windows cache permission errors by setting a custom user data directory
const customUserDataPath = getWrDeskUserDataPath()
app.setPath('userData', customUserDataPath)
markUserDataPathBootstrapped()

export { isUserDataPathBootstrapped } from './userDataBootstrapState'
