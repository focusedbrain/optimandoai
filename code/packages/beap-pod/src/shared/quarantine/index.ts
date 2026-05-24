export {
  DEFAULT_QUARANTINE_DIR,
  QuarantineStore,
  type WriteQuarantineEntryArgs,
} from './store.js';
export {
  clearQuarantineKeyForTests,
  getQuarantineKey,
  hasQuarantineKey,
  setQuarantineKeyFromHex,
} from './keyStore.js';
export {
  decryptQuarantineBytes,
  encryptQuarantineBytes,
  parseQuarantineKeyHex,
} from './crypto.js';
export type { EncryptedQuarantineWire, QuarantineMetadata } from './types.js';
