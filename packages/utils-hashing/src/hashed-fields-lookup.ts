/**
 * Encrypted Fields Registry
 *
 * Central registry of all PII fields that must be encrypted at rest.
 * All fields use AES-256-GCM for authenticated encryption.
 *
 * Projects can register custom entity types at startup via registerHashedFields().
 */

const hashedFields: Record<string, true> = {
  // User PII (built-in defaults)
  'user.email': true,
  'user.phoneNumber': true,
};

/**
 * Read-only snapshot of built-in defaults for backward compatibility.
 */
export const HASHED_FIELDS = hashedFields;

export type HashedFieldPath = string;

/**
 * Register additional PII fields for a custom entity type.
 *
 * Call at app startup before any hashing operations.
 *
 * @example
 * registerHashedFields('employee', ['email', 'ssn', 'phone']);
 * registerHashedFields('account', ['abn', 'taxFileNumber']);
 */
export function registerHashedFields(entityType: string, fields: string[]): void {
  for (const field of fields) {
    hashedFields[`${entityType}.${field}`] = true;
  }
}

/**
 * Check if a field path should be hashed
 */
export function isHashedField(fieldPath: string): boolean {
  return fieldPath in hashedFields;
}
