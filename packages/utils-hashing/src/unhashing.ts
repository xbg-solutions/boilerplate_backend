/**
 * PII Decryption Utilities (Lazy Pattern)
 *
 * Decrypt PII fields on-demand when explicitly requested.
 * Uses AES-256-GCM for authenticated decryption.
 *
 * Encrypted format: `${iv}:${encrypted}:${authTag}` (all base64 encoded)
 */

import * as crypto from 'crypto';
import { isHashedField } from './hashed-fields-lookup';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits

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
 * Check if a value appears to be AES-256-GCM encrypted
 * Format: iv:encrypted:authTag (base64 strings separated by colons)
 */
function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(part => part.length > 0);
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