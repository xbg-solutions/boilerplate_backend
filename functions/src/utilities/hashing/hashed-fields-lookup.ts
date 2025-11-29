/**
 * Encrypted Fields Registry
 *
 * Central registry of all PII fields that must be encrypted at rest.
 * All fields use AES-256-GCM for authenticated encryption.
 */

export const HASHED_FIELDS = {
  // Users (identityDB)
  'user.email': true,
  'user.phoneNumber': true,

  // Contacts (relationshipsDB)
  'contact.email': true,
  'contact.phoneNumber': true,

  // Addresses (relationshipsDB)
  'address.addressLine1': true,
  'address.addressLine2': true,
  'address.city': true,
  'address.state': true,
  'address.postalCode': true,
  'address.country': true,
} as const;

export type HashedFieldPath = keyof typeof HASHED_FIELDS;

/**
 * Check if a field path should be hashed
 */
export function isHashedField(fieldPath: string): boolean {
  return fieldPath in HASHED_FIELDS;
}