/**
 * Encrypted Fields Registry
 *
 * Central registry of all PII fields that must be encrypted at rest.
 * All fields use AES-256-GCM for authenticated encryption.
 */

export const HASHED_FIELDS = {
  // User PII
  'user.email': true,
  'user.phoneNumber': true,

  // Add project-specific PII fields here, e.g.:
  // 'customer.email': true,
  // 'address.addressLine1': true,
} as const;

export type HashedFieldPath = keyof typeof HASHED_FIELDS;

/**
 * Check if a field path should be hashed
 */
export function isHashedField(fieldPath: string): boolean {
  return fieldPath in HASHED_FIELDS;
}