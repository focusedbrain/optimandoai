/**
 * BEAP pdf-parser role entry (dispatcher target for BEAP_ROLE=pdf-parser).
 */

export {
  createPdfParserServer,
  startPdfParserServer,
  ROLE,
  DEFAULT_PORT,
} from './pdf-parser/index.js';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startPdfParserServer } from './pdf-parser/index.js';

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/pdf-parser.js')) {
  startPdfParserServer();
}
