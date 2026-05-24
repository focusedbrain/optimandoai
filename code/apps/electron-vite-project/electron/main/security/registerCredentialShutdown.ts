/**
 * Belt-and-suspenders: zero all registered credential holders on app quit.
 */

import { app } from 'electron'

import { zeroizeAllRegisteredCredentials } from './zeroize.js'

let _registered = false

export function registerCredentialShutdownHandlers(): void {
  if (_registered) return
  _registered = true

  app.on('before-quit', () => {
    zeroizeAllRegisteredCredentials()
  })
}
