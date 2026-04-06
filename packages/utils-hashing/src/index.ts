/**
 * Hashing utilities barrel export
 */

// Registry
export {
  HASHED_FIELDS,
  isHashedField,
  registerHashedFields,
  getFieldMode,
  getTransparentFields,
  getGuardedFields,
  PII_BLOB_KEY,
} from './hashed-fields-lookup';
export type { HashedFieldPath, HashedFieldMode } from './hashed-fields-lookup';

// Encryption
export { hashValue, hashFields, hashFieldsByName, hashTransparentFields, hashTransparentFieldsByName } from './hasher';

// Decryption
export { unhashValue, unhashFields, unhashFieldsByName, unhashTransparentFields, unhashTransparentFieldsByName } from './unhashing';
