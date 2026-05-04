/**
 * PII Encryption Utilities
 *
 * Encrypt PII fields before storage using AES-256-GCM.
 * AES-256-GCM provides authenticated encryption with reversible decryption.
 *
 * Encrypted format: `${iv}:${encrypted}:${authTag}` (all base64 encoded)
 */

import * as crypto from 'crypto';
import {
  isHashedField,
  getTransparentFields,
  getGuardedFields,
  PII_BLOB_KEY,
  PII_JSON_SENTINEL,
} from './hashed-fields-lookup';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const KEY_LENGTH = 32; // 256 bits

/**
 * Shape check for an AES-256-GCM ciphertext string produced by hashValue:
 * `${iv}:${encrypted}:${authTag}` (base64, 12-byte IV → 16 chars, 16-byte
 * auth tag → 24 chars). Used to make the hashers idempotent: merge flows
 * that pass stored ciphertext back through on write should not re-encrypt.
 */
function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3 || parts.some(p => p.length === 0)) return false;
  const [iv, , authTag] = parts;
  return iv.length === 16 && authTag.length === 24;
}

/**
 * Prepare a value for AES-GCM encryption. Strings pass through unchanged
 * (backward compat with pre-sentinel data). Objects, arrays, numbers, and
 * booleans are JSON-stringified with PII_JSON_SENTINEL prepended so decrypt
 * can distinguish them from plain strings.
 *
 * Returns null if the value should not be encrypted (null/undefined/empty
 * string, or an already-encrypted ciphertext string — idempotency for
 * merge-then-rewrite flows).
 */
function serializeForEncryption(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    if (looksEncrypted(value)) return null;
    return value;
  }
  if (typeof value === 'object' || typeof value === 'number' || typeof value === 'boolean') {
    return PII_JSON_SENTINEL + JSON.stringify(value);
  }
  return null;
}

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
 * Delete a value at a dot-separated path
 */
function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current != null && typeof current === 'object') {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]];
  }
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
 * Encrypt a single value using AES-256-GCM
 *
 * @param value - Plaintext value to encrypt
 * @returns Encrypted value in format: `${iv}:${encrypted}:${authTag}` (base64)
 */
export function hashValue(value: string): string {
  const key = getEncryptionKey();

  // Generate random IV (initialization vector)
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the value
  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Return in format: iv:encrypted:authTag (all base64)
  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
}


/**
 * Hash all PII fields in an object based on entity type.
 *
 * Uses the hashed fields registry to determine which fields to encrypt.
 * Register custom entity types with registerHashedFields() before calling.
 *
 * @param data - Object containing fields to hash
 * @param entityType - Type of entity (e.g. 'user', 'contact', or any registered type)
 * @returns New object with hashed fields
 *
 * @example
 * hashFields({ email: 'test@example.com' }, 'user')
 */
export function hashFields<T extends Record<string, unknown>>(
  data: T,
  entityType: string
): T {
  const result = { ...data };

  for (const fieldName of Object.keys(result)) {
    const fieldPath = `${entityType}.${fieldName}`;

    if (isHashedField(fieldPath)) {
      const serialized = serializeForEncryption(result[fieldName]);
      if (serialized !== null) {
        (result as Record<string, unknown>)[fieldName] = hashValue(serialized);
      }
    }
  }

  return result;
}

/**
 * Hash specific fields in an object by field name.
 *
 * Unlike hashFields(), this does not use the registry — you pass the
 * field names directly. Preferred for project-specific entities.
 *
 * @param data - Object containing fields to hash
 * @param fields - Array of field names to encrypt (e.g. ['email', 'phone'])
 * @returns New object with specified fields hashed
 *
 * @example
 * hashFieldsByName({ email: 'test@example.com', name: 'Alice' }, ['email'])
 * // Returns { email: '<encrypted>', name: 'Alice' }
 */
export function hashFieldsByName<T extends Record<string, unknown>>(
  data: T,
  fields: string[]
): T {
  const result = { ...data };

  for (const fieldName of fields) {
    const serialized = serializeForEncryption(result[fieldName]);
    if (serialized !== null) {
      (result as Record<string, unknown>)[fieldName] = hashValue(serialized);
    }
  }

  return result;
}


/**
 * Encrypt fields using transparent/guarded modes from the registry.
 *
 * - **Transparent** fields are bundled into a single encrypted JSON blob
 *   stored under `_pii`, and their original keys are removed. This gives
 *   O(1) crypto cost regardless of how many transparent fields exist.
 *
 * - **Guarded** fields are encrypted individually (same as hashFields).
 *
 * @param data - Object containing fields to encrypt
 * @param entityType - Registered entity type (e.g. 'contact')
 * @returns New object with transparent fields bundled into `_pii` and guarded fields encrypted individually
 *
 * @example
 * // Given: registerHashedFields('contact', ['email', 'phone'], 'transparent');
 * //        registerHashedFields('contact', ['ssn'], 'guarded');
 * hashTransparentFields({ email: 'a@b.com', phone: '+61...', ssn: '123', name: 'Jo' }, 'contact')
 * // → { _pii: '<blob>', ssn: '<encrypted>', name: 'Jo' }
 */
export function hashTransparentFields<T extends Record<string, unknown>>(
  data: T,
  entityType: string
): T {
  const result = { ...data };
  const transparentFieldNames = getTransparentFields(entityType);
  const guardedFieldNames = getGuardedFields(entityType);

  // Deep-clone nested objects that will be mutated by dot-path operations
  for (const fieldName of [...transparentFieldNames, ...guardedFieldNames]) {
    if (fieldName.includes('.')) {
      const topKey = fieldName.split('.')[0];
      if (result[topKey] && typeof result[topKey] === 'object') {
        (result as Record<string, unknown>)[topKey] = { ...(result[topKey] as Record<string, unknown>) };
      }
    }
  }

  // Bundle transparent fields into a single encrypted blob. The bundle
  // itself is JSON-serialized, so nested objects / numbers / booleans
  // roundtrip naturally — no per-value sentinel needed inside the bundle.
  if (transparentFieldNames.length > 0) {
    const bundle: Record<string, unknown> = {};

    for (const fieldName of transparentFieldNames) {
      const isDotPath = fieldName.includes('.');
      const value = isDotPath
        ? getNestedValue(result as Record<string, unknown>, fieldName)
        : result[fieldName];

      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.length === 0) continue;

      bundle[fieldName] = value;
      if (isDotPath) {
        deleteNestedValue(result as Record<string, unknown>, fieldName);
      } else {
        delete (result as Record<string, unknown>)[fieldName];
      }
    }

    if (Object.keys(bundle).length > 0) {
      (result as Record<string, unknown>)[PII_BLOB_KEY] = hashValue(JSON.stringify(bundle));
    }
  }

  // Encrypt guarded fields individually. Non-string values (address objects,
  // numeric caps, etc.) are sentinel-tagged so decrypt can JSON.parse them.
  for (const fieldName of guardedFieldNames) {
    const isDotPath = fieldName.includes('.');
    const value = isDotPath
      ? getNestedValue(result as Record<string, unknown>, fieldName)
      : result[fieldName];

    const serialized = serializeForEncryption(value);
    if (serialized !== null) {
      const encrypted = hashValue(serialized);
      if (isDotPath) {
        setNestedValue(result as Record<string, unknown>, fieldName, encrypted);
      } else {
        (result as Record<string, unknown>)[fieldName] = encrypted;
      }
    }
  }

  return result;
}


/**
 * Encrypt fields using transparent/guarded classification by explicit field names.
 *
 * Same as hashTransparentFields but without registry lookup — you pass
 * the field names directly. Supports dot-path field names for nested objects
 * (e.g., 'contactPerson.email').
 *
 * @param data - Object containing fields to encrypt
 * @param transparentFields - Fields to bundle into `_pii` blob (supports dot-paths)
 * @param guardedFields - Fields to encrypt individually (supports dot-paths, optional)
 * @returns New object with transparent fields in `_pii` and guarded fields encrypted
 *
 * @example
 * hashTransparentFieldsByName(
 *   { email: 'a@b.com', contact: { phone: '+61...' }, ssn: '123', name: 'Jo' },
 *   ['email', 'contact.phone'],  // transparent
 *   ['ssn']                      // guarded
 * )
 */
export function hashTransparentFieldsByName<T extends Record<string, unknown>>(
  data: T,
  transparentFields: string[],
  guardedFields: string[] = []
): T {
  const result = { ...data };

  // Deep-clone nested objects that will be mutated by dot-path operations
  for (const fieldName of [...transparentFields, ...guardedFields]) {
    if (fieldName.includes('.')) {
      const topKey = fieldName.split('.')[0];
      if (result[topKey] && typeof result[topKey] === 'object') {
        (result as Record<string, unknown>)[topKey] = { ...(result[topKey] as Record<string, unknown>) };
      }
    }
  }

  // Bundle transparent fields into a single encrypted blob. The bundle
  // itself is JSON-serialized, so nested objects / numbers / booleans
  // roundtrip naturally — no per-value sentinel needed inside the bundle.
  if (transparentFields.length > 0) {
    const bundle: Record<string, unknown> = {};

    for (const fieldName of transparentFields) {
      const isDotPath = fieldName.includes('.');
      const value = isDotPath
        ? getNestedValue(result as Record<string, unknown>, fieldName)
        : result[fieldName];

      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.length === 0) continue;

      bundle[fieldName] = value;
      if (isDotPath) {
        deleteNestedValue(result as Record<string, unknown>, fieldName);
      } else {
        delete (result as Record<string, unknown>)[fieldName];
      }
    }

    if (Object.keys(bundle).length > 0) {
      (result as Record<string, unknown>)[PII_BLOB_KEY] = hashValue(JSON.stringify(bundle));
    }
  }

  // Encrypt guarded fields individually. Non-string values (address objects,
  // numeric caps, etc.) are sentinel-tagged so decrypt can JSON.parse them.
  for (const fieldName of guardedFields) {
    const isDotPath = fieldName.includes('.');
    const value = isDotPath
      ? getNestedValue(result as Record<string, unknown>, fieldName)
      : result[fieldName];

    const serialized = serializeForEncryption(value);
    if (serialized !== null) {
      const encrypted = hashValue(serialized);
      if (isDotPath) {
        setNestedValue(result as Record<string, unknown>, fieldName, encrypted);
      } else {
        (result as Record<string, unknown>)[fieldName] = encrypted;
      }
    }
  }

  return result;
}
