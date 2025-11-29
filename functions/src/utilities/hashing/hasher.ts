/**
 * PII Encryption Utilities
 *
 * Encrypt PII fields before storage using AES-256-GCM.
 * AES-256-GCM provides authenticated encryption with reversible decryption.
 *
 * Encrypted format: `${iv}:${encrypted}:${authTag}` (all base64 encoded)
 */

import * as crypto from 'crypto';
import { isHashedField } from './hashed-fields-lookup';

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
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
 * Hash all PII fields in an object based on entity type
 * 
 * @param data - Object containing fields to hash
 * @param entityType - Type of entity ('user', 'contact', 'address')
 * @returns New object with hashed fields
 * 
 * @example
 * hashFields({ email: 'test@example.com' }, 'user')
 * // Returns { email: '$2b$10$...' }
 */
export function hashFields<T extends Record<string, unknown>>(
  data: T,
  entityType: 'user' | 'contact' | 'address'
): T {
  const result = { ...data };

  // Iterate through top-level fields and check if they should be hashed
  for (const fieldName of Object.keys(result)) {
    const fieldPath = `${entityType}.${fieldName}`;
    
    if (isHashedField(fieldPath)) {
      const value = result[fieldName];
      
      // Only hash non-null, non-empty strings
      if (value && typeof value === 'string' && value.length > 0) {
        (result as Record<string, unknown>)[fieldName] = hashValue(value);
      }
    }
  }

  return result;
}