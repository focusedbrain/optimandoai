/**
 * Shim for extension-chromium reconstruction module — stubs for Electron.
 * Content reconstruction is not available in the desktop app yet.
 */

export function SafePreviewPanel() { return null }
export function ReconstructionStatus() { return null }
export function SemanticPreview() { return null }
export function RasterPreview() { return null }

export function useReconstructionStore() { return {} }
export function useReconstructionState() { return 'idle' }
export function useIsReconstructed() { return false }
export function useSemanticText() { return [] }
export function useRasterRefs() { return [] }

export function useReconstruction() { return { state: 'idle', run: async () => {} } }

export async function runReconstruction() { return null }
export function canReconstruct() { return false }
export function validateReconstructionIntegrity() { return true }

export const TIKA_SUPPORTED_TYPES: string[] = []
export const PDFIUM_SUPPORTED_TYPES: string[] = []
export function isTikaSupported() { return false }
export function isPdfiumSupported() { return false }
