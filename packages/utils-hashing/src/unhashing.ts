/**
 * PII Decryption Utilities (Lazy Pattern)
 *
 * Decrypt PII fields on-demand when explicitly requested.
 * Uses AES-256-GCM for authenticated decryption.
 *
 * Encrypted format: `${iv}:${encrypted}:${authTag}` (all base64 encoded)
 */

import * as crypto from 'crypto';
import {
  isHashedField,
  getTransparentFields,
  PII_BLOB_KEY,
} from './hashed-fields-lookup';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits

/**
 * Get a value at a dot-separated path (e.g., 'contactPerson.email')
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value at a dot-separated path, creating intermediate objects as needed
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Get encryption key from environment
 * Key must be 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.PII_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'PII_ENCRYPTION_KEY not found in environment. ' +
      'Generate with: openssl rand -hex 32'
    );
  }

  // Validate key length
  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `PII_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
      `Current length: ${keyHex.length}`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Check if a value appears to be AES-256-GCM encrypted.
 * Format: iv:encrypted:authTag (base64 strings separated by colons)
 *
 * Validates structural properties to avoid false positives on
 * colon-delimited strings (e.g., "10:30:00", URLs with ports):
 * - 12-byte IV → 16 base64 chars
 * - 16-byte GCM auth tag → 24 base64 chars
 */
function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    return false;
  }
  const [iv, , authTag] = parts;
  return iv.length === 16 && authTag.length === 24;
}

/**
 * Decrypt a single value using AES-256-GCM
 *
 * @param encryptedValue - Encrypted value in format: `${iv}:${encrypted}:${authTag}` (base64)
 * @returns Decrypted plaintext value
 * @throws Error if decryption fails or format is invalid
 */
export function unhashValue(value: string): string {
  // Validate format
  if (!isEncrypted(value)) {
    throw new Error(
      'Invalid encrypted value format. ' +
      'Expected: iv:encrypted:authTag (base64)'
    );
  }

  const key = getEncryptionKey();

  // Parse encrypted value components
  const [ivBase64, encryptedBase64, authTagBase64] = value.split(':');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    // Decrypt the value
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(
      'Decryption failed. This may indicate data corruption or wrong encryption key. ' +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Unhash specific fields in an object (lazy pattern)
 *
 * Services explicitly request which fields to unhash.
 * No automatic unhashing on every GET request.
 *
 * @param data - Object containing hashed fields
 * @param fieldsToUnhash - Array of field paths to unhash (e.g., ['contact.email'])
 * @returns New object with unhashed fields
 *
 * @example
 * unhashFields(contactData, ['contact.email', 'contact.phoneNumber'])
 */
export function unhashFields<T extends Record<string, unknown>>(
  data: T,
  fieldsToUnhash: string[]
): T {
  const result = { ...data };

  for (const fieldPath of fieldsToUnhash) {
    // Validate that this field is actually an encrypted field
    if (!isHashedField(fieldPath)) {
      continue;
    }

    // Extract entity type and field name from path
    // e.g., 'contact.email' -> entityType='contact', fieldName='email'
    const parts = fieldPath.split('.');
    if (parts.length !== 2) {
      continue;
    }

    const fieldName = parts[1];
    const value = result[fieldName];

    // Only attempt to decrypt string values that appear to be encrypted
    if (value && typeof value === 'string' && isEncrypted(value)) {
      (result as Record<string, unknown>)[fieldName] = unhashValue(value);
    }
  }

  return result;
}

/**
 * Unhash specific fields in an object by field name.
 *
 * Unlike unhashFields(), this does not check the registry — you pass the
 * field names directly. Preferred for project-specific entities.
 *
 * @param data - Object containing hashed fields
 * @param fields - Array of field names to decrypt (e.g. ['email', 'phone'])
 * @returns New object with specified fields unhashed
 *
 * @example
 * unhashFieldsByName(userData, ['email', 'phone'])
 */
export function unhashFieldsByName<T extends Record<string, unknown>>(
  data: T,
  fields: string[]
): T {
  const result = { ...data };

  for (const fieldName of fields) {
    const value = result[fieldName];

    if (value && typeof value === 'string' && isEncrypted(value)) {
      (result as Record<string, unknown>)[fieldName] = unhashValue(value);
    }
  }

  return result;
}


/**
 * Decrypt transparent fields from the `_pii` blob (single crypto operation).
 *
 * If the document has a `_pii` blob, it is decrypted and its fields are
 * spread back onto the returned object. If no blob exists (legacy data),
 * falls back to per-field decryption for registered transparent fields.
 *
 * Guarded fields are left untouched — use unhashFields() for those.
 *
 * @param data - Object from storage (may contain `_pii` blob or legacy per-field encryption)
 * @param entityType - Registered entity type (e.g. 'contact')
 * @returns New object with transparent fields restored in plaintext
 *
 * @example
 * // New format (blob):
 * unhashTransparentFields({ _pii: '<blob>', ssn: '<encrypted>', name: 'Jo' }, 'contact')
 * // → { email: 'a@b.com', phone: '+61...', ssn: '<encrypted>', name: 'Jo' }
 *
 * // Legacy format (per-field) — handled via fallback:
 * unhashTransparentFields({ email: '<encrypted>', ssn: '<encrypted>' }, 'contact')
 * // → { email: 'a@b.com', ssn: '<encrypted>' }
 */
export function unhashTransparentFields<T extends Record<string, unknown>>(
  data: T,
  entityType: string
): T {
  const result = { ...data };
  const piiBlob = result[PII_BLOB_KEY];

  if (piiBlob && typeof piiBlob === 'string' && isEncrypted(piiBlob)) {
    // New format: decrypt the blob and spread fields back
    const decryptedJson = unhashValue(piiBlob);
    const fields = JSON.parse(decryptedJson) as Record<string, string>;

    for (const [fieldName, value] of Object.entries(fields)) {
      if (fieldName.includes('.')) {
        setNestedValue(result as Record<string, unknown>, fieldName, value);
      } else {
        (result as Record<string, unknown>)[fieldName] = value;
      }
    }

    delete (result as Record<string, unknown>)[PII_BLOB_KEY];
  } else {
    // Migration fallback: decrypt transparent fields individually
    const transparentFieldNames = getTransparentFields(entityType);

    for (const fieldName of transparentFieldNames) {
      const isDotPath = fieldName.includes('.');
      const value = isDotPath
        ? getNestedValue(result as Record<string, unknown>, fieldName)
        : result[fieldName];

      if (value && typeof value === 'string' && isEncrypted(value)) {
        if (isDotPath) {
          setNestedValue(result as Record<string, unknown>, fieldName, unhashValue(value));
        } else {
          (result as Record<string, unknown>)[fieldName] = unhashValue(value);
        }
      }
    }
  }

  return result;
}


/**
 * Decrypt transparent fields by explicit field names (no registry lookup).
 *
 * If the document has a `_pii` blob, it is decrypted and matching fields
 * are spread back. Otherwise falls back to per-field decryption.
 * Supports dot-path field names for nested objects.
 *
 * @param data - Object from storage
 * @param transparentFields - Field names expected in the blob (e.g. ['email', 'contact.phone'])
 * @returns New object with transparent fields restored in plaintext
 */
export function unhashTransparentFieldsByName<T extends Record<string, unknown>>(
  data: T,
  transparentFields: string[]
): T {
  const result = { ...data };
  const piiBlob = result[PII_BLOB_KEY];

  if (piiBlob && typeof piiBlob === 'string' && isEncrypted(piiBlob)) {
    // New format: decrypt the blob and spread fields back
    const decryptedJson = unhashValue(piiBlob);
    const fields = JSON.parse(decryptedJson) as Record<string, string>;

    for (const [fieldName, value] of Object.entries(fields)) {
      if (fieldName.includes('.')) {
        setNestedValue(result as Record<string, unknown>, fieldName, value);
      } else {
        (result as Record<string, unknown>)[fieldName] = value;
      }
    }

    delete (result as Record<string, unknown>)[PII_BLOB_KEY];
  } else {
    // Migration fallback: decrypt listed fields individually
    for (const fieldName of transparentFields) {
      const isDotPath = fieldName.includes('.');
      const value = isDotPath
        ? getNestedValue(result as Record<string, unknown>, fieldName)
        : result[fieldName];

      if (value && typeof value === 'string' && isEncrypted(value)) {
        if (isDotPath) {
          setNestedValue(result as Record<string, unknown>, fieldName, unhashValue(value));
        } else {
          (result as Record<string, unknown>)[fieldName] = unhashValue(value);
        }
      }
    }
  }

  return result;
}
