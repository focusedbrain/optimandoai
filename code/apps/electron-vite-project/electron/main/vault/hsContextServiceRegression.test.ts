/**
 * Regression test: HS Context service methods must not fail due to module-loading issues.
 *
 * Root cause that was fixed:
 *   service.ts previously used bare require('./hsContextProfileService') and
 *   require('./hsContextAccessService') inside method bodies.  In the ESM main
 *   process ("type":"module") bare require is undefined, so every HS Context RPC
 *   call threw "require is not defined".  A subsequent attempt used
 *   createRequire(import.meta.url), which resolved correctly in source but failed
 *   after Vite bundling because the relative path './hsContextProfileService' is
 *   no longer a real file next to the bundle.
 *
 * Fix:
 *   All HS Context imports in service.ts were converted to static top-level ESM
 *   imports.  Vite inlines the imported code at build time so no runtime module
 *   resolution is needed — the bundle is self-contained.
 *
 * This test verifies:
 *   A. The named exports from hsContextProfileService are importable as ESM.
 *   B. The named exports from hsContextAccessService are importable as ESM.
 *   C. VaultService.listHsProfiles and VaultService.createHsProfile are callable
 *      functions (not undefined), confirming the static imports wired up correctly.
 */

import { describe, it, expect } from 'vitest'

// ── A. hsContextProfileService exports are reachable as static ESM ──
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  archiveProfile,
  deleteProfile,
  duplicateProfile,
  uploadProfileDocument,
  updateProfileDocumentMeta,
  deleteProfileDocument,
  resolveProfilesForHandshake,
} from './hsContextProfileService'

// ── B. hsContextAccessService exports are reachable as static ESM ──
import {
  requestOriginalDocumentContent,
  requestLinkOpenApproval,
} from './hsContextAccessService'

// ── C. VaultService method shapes ──
import { VaultService } from './service'

describe('HS Context service — static ESM import regression', () => {
  it('A: all required hsContextProfileService exports are functions', () => {
    expect(typeof listProfiles).toBe('function')
    expect(typeof getProfile).toBe('function')
    expect(typeof createProfile).toBe('function')
    expect(typeof updateProfile).toBe('function')
    expect(typeof archiveProfile).toBe('function')
    expect(typeof deleteProfile).toBe('function')
    expect(typeof duplicateProfile).toBe('function')
    expect(typeof uploadProfileDocument).toBe('function')
    expect(typeof updateProfileDocumentMeta).toBe('function')
    expect(typeof deleteProfileDocument).toBe('function')
    expect(typeof resolveProfilesForHandshake).toBe('function')
  })

  it('B: all required hsContextAccessService exports are functions', () => {
    expect(typeof requestOriginalDocumentContent).toBe('function')
    expect(typeof requestLinkOpenApproval).toBe('function')
  })

  it('C: VaultService.listHsProfiles and VaultService.createHsProfile are functions', () => {
    // We only check that the prototype methods exist and are functions.
    // Calling them requires an unlocked DB which is tested in
    // hsContextProfileService.test.ts; here we guard against the method
    // being undefined (which would happen if the import silently failed).
    const proto = VaultService.prototype
    expect(typeof proto.listHsProfiles).toBe('function')
    expect(typeof proto.createHsProfile).toBe('function')
    expect(typeof proto.getHsProfile).toBe('function')
    expect(typeof proto.updateHsProfile).toBe('function')
    expect(typeof proto.archiveHsProfile).toBe('function')
    expect(typeof proto.deleteHsProfile).toBe('function')
    expect(typeof proto.duplicateHsProfile).toBe('function')
    expect(typeof proto.uploadHsProfileDocument).toBe('function')
    expect(typeof proto.updateHsProfileDocumentMeta).toBe('function')
    expect(typeof proto.deleteHsProfileDocument).toBe('function')
    expect(typeof proto.resolveHsProfilesForHandshake).toBe('function')
    expect(typeof proto.requestOriginalDocumentContent).toBe('function')
    expect(typeof proto.requestLinkOpenApproval).toBe('function')
  })
})
