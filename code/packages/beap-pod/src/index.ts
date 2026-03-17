/**
 * BEAP Pod — Structural validation + HTTP server
 */

export { validateBeapStructure, SIZE_LIMITS } from './beapStructuralValidator.js';
export type { StructuralValidationResult } from './beapStructuralValidator.js';
export { createPodServer, startPodServer } from './podServer.js';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startPodServer } from './podServer.js';

const __filename = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (entry === __filename || process.argv[1]?.endsWith('index.js')) {
  startPodServer();
}
