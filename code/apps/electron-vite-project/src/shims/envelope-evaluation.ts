/**
 * Shim for extension-chromium envelope-evaluation module — stubs for Electron.
 */

export function useVerifyMessage() {
  return {
    verifyMessage: async (_id: string) => {
      console.log('[BEAP-Electron] verifyMessage stub:', _id)
      return { success: true }
    },
    isVerifying: false,
  }
}

export function evaluateIncomingMessage() { return null }
export function createMockIncomingMessage() { return null }
