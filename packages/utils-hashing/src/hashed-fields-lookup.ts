/**
 * Encrypted Fields Registry
 *
 * Central registry of all PII fields that must be encrypted at rest.
 * Fields can be registered as 'transparent' or 'guarded':
 *
 * - **transparent**: Encrypted at rest, auto-decrypted on read via a bundled blob (_pii).
 *   Use for display PII (names, emails, phones) that is always needed in plaintext.
 *
 * - **guarded**: Encrypted individually per-field, requires explicit decrypt.
 *   Use for secrets (API keys, SSNs, tax file numbers) that warrant deliberate reveal.
 *
 * Projects can register custom entity types at startup via registerHashedFields().
 */

/**
 * Encryption mode for a hashed field.
 * - 'transparent': bundled into _pii blob, auto-decrypted on read (O(1) per object)
 * - 'guarded': encrypted per-field, explicit decrypt only (current/default behavior)
 */
export type HashedFieldMode = 'transparent' | 'guarded';

interface HashedFieldConfig {
  mode: HashedFieldMode;
}

/**
 * Reserved key used to store the encrypted blob of transparent fields on a document.
 */
export const PII_BLOB_KEY = '_pii';

const hashedFields: Record<string, HashedFieldConfig> = {
  // User PII (built-in defaults — guarded for backward compatibility)
  'user.email': { mode: 'guarded' },
  'user.phoneNumber': { mode: 'guarded' },
};

/**
 * Read-only snapshot of the registry.
 */
export const HASHED_FIELDS = hashedFields;

export type HashedFieldPath = string;

/**
 * Register additional PII fields for a custom entity type.
 *
 * Call at app startup before any hashing operations.
 *
 * @param entityType - Entity name (e.g. 'user', 'contact', 'employee')
 * @param fields - Array of field names to encrypt
 * @param mode - 'transparent' (bundled blob) or 'guarded' (per-field). Defaults to 'guarded'.
 *
 * @example
 * registerHashedFields('contact', ['firstName', 'email', 'phone'], 'transparent');
 * registerHashedFields('contact', ['ssn', 'taxFileNumber'], 'guarded');
 * registerHashedFields('employee', ['email', 'ssn', 'phone']); // defaults to 'guarded'
 */
export function registerHashedFields(
  entityType: string,
  fields: string[],
  mode: HashedFieldMode = 'guarded'
): void {
  for (const field of fields) {
    hashedFields[`${entityType}.${field}`] = { mode };
  }
}

/**
 * Check if a field path should be hashed (any mode)
 */
export function isHashedField(fieldPath: string): boolean {
  return fieldPath in hashedFields;
}

/**
 * Get the encryption mode for a field path, or undefined if not registered.
 */
export function getFieldMode(fieldPath: string): HashedFieldMode | undefined {
  return hashedFields[fieldPath]?.mode;
}

/**
 * Get all transparent field names for an entity type.
 * Returns field names only (without the entity prefix).
 *
 * @example
 * getTransparentFields('contact') // ['firstName', 'email', 'phone']
 */
export function getTransparentFields(entityType: string): string[] {
  const prefix = `${entityType}.`;
  return Object.entries(hashedFields)
    .filter(([key, config]) => key.startsWith(prefix) && config.mode === 'transparent')
    .map(([key]) => key.slice(prefix.length));
}

/**
 * Get all guarded field names for an entity type.
 * Returns field names only (without the entity prefix).
 *
 * @example
 * getGuardedFields('contact') // ['ssn', 'taxFileNumber']
 */
export function getGuardedFields(entityType: string): string[] {
  const prefix = `${entityType}.`;
  return Object.entries(hashedFields)
    .filter(([key, config]) => key.startsWith(prefix) && config.mode === 'guarded')
    .map(([key]) => key.slice(prefix.length));
}
