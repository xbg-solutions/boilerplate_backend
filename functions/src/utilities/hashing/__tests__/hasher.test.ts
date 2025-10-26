/**
 * Hasher Utilities - Unit Tests
 *
 * Testing WHAT the hasher does, not HOW it works internally:
 * - Encrypts values using AES-256-GCM
 * - Produces different encrypted values for same input (random IV)
 * - Handles edge cases (empty strings, nulls, etc.)
 * - Validates encryption key requirements
 */

import { hashValue, hashFields } from '../hasher';

// Mock environment variable
const VALID_KEY = 'a'.repeat(64); // 64 hex characters = 32 bytes

describe('Hasher Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    process.env.PII_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('hashValue', () => {
    it('encrypts a string value successfully', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);

      // Verify encrypted format: iv:encrypted:authTag (base64)
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(encrypted).not.toBe(plaintext);
    });

    it('produces different encrypted values for same input due to random IV', () => {
      const plaintext = 'test@example.com';
      const encrypted1 = hashValue(plaintext);
      const encrypted2 = hashValue(plaintext);

      // Different IVs mean different encrypted values
      expect(encrypted1).not.toBe(encrypted2);

      // Both should have valid format
      expect(encrypted1).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(encrypted2).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('encrypts values with special characters', () => {
      const values = [
        'test+tag@example.com',
        '+61412345678',
        '123 Main St, Apt #4',
        "O'Brien's Address",
      ];

      values.forEach((value) => {
        const encrypted = hashValue(value);
        expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
        expect(encrypted).not.toBe(value);
      });
    });

    it('encrypts empty string', () => {
      const encrypted = hashValue('');
      // Empty string encryption still produces valid format, though encrypted part may be empty
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBeGreaterThan(0); // IV
      expect(parts[2].length).toBeGreaterThan(0); // Auth tag
    });

    it('throws error when PII_ENCRYPTION_KEY is missing', () => {
      delete process.env.PII_ENCRYPTION_KEY;

      expect(() => hashValue('test@example.com')).toThrow(
        'PII_ENCRYPTION_KEY not found in environment'
      );
    });

    it('throws error when PII_ENCRYPTION_KEY has invalid length', () => {
      // Too short
      process.env.PII_ENCRYPTION_KEY = 'abc123';

      expect(() => hashValue('test@example.com')).toThrow(
        /PII_ENCRYPTION_KEY must be 64 hex characters/
      );

      // Too long
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(128);

      expect(() => hashValue('test@example.com')).toThrow(
        /PII_ENCRYPTION_KEY must be 64 hex characters/
      );
    });

    it('throws error when PII_ENCRYPTION_KEY has invalid hex characters', () => {
      process.env.PII_ENCRYPTION_KEY = 'z'.repeat(64); // Invalid hex

      expect(() => hashValue('test@example.com')).toThrow();
    });

    it('handles very long strings', () => {
      const longString = 'a'.repeat(10000);
      const encrypted = hashValue(longString);

      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('handles unicode characters', () => {
      const unicodeValues = [
        '测试@example.com',
        'tëst@example.com',
        '🎉 Party Address',
        'Москва, Россия',
      ];

      unicodeValues.forEach((value) => {
        const encrypted = hashValue(value);
        expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      });
    });
  });

  describe('hashFields', () => {
    it('hashes specified fields for user entity', () => {
      const userData = {
        userUID: 'user123',
        email: 'test@example.com',
        phoneNumber: '+61412345678',
        fullName: 'John Doe',
      };

      const result = hashFields(userData, 'user');

      // Hashed fields should be encrypted
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.email).not.toBe(userData.email);

      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).not.toBe(userData.phoneNumber);

      // Non-hashed fields should remain unchanged
      expect(result.userUID).toBe(userData.userUID);
      expect(result.fullName).toBe(userData.fullName);
    });

    it('hashes specified fields for contact entity', () => {
      const contactData = {
        contactUID: 'contact123',
        email: 'contact@example.com',
        phoneNumber: '+61412345678',
        fullName: 'Jane Smith',
      };

      const result = hashFields(contactData, 'contact');

      // Hashed fields should be encrypted
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed fields should remain unchanged
      expect(result.contactUID).toBe(contactData.contactUID);
      expect(result.fullName).toBe(contactData.fullName);
    });

    it('hashes specified fields for address entity', () => {
      const addressData = {
        addressUID: 'address123',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4',
        city: 'Sydney',
        state: 'NSW',
        postalCode: '2000',
        country: 'Australia',
        isDefault: true,
      };

      const result = hashFields(addressData, 'address');

      // All address fields should be encrypted
      expect(result.addressLine1).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.addressLine2).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.city).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.state).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.postalCode).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.country).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed fields should remain unchanged
      expect(result.addressUID).toBe(addressData.addressUID);
      expect(result.isDefault).toBe(addressData.isDefault);
    });

    it('does not modify original object', () => {
      const original = {
        email: 'test@example.com',
        phoneNumber: '+61412345678',
      };

      const originalEmail = original.email;
      const originalPhone = original.phoneNumber;

      hashFields(original, 'user');

      // Original should be unchanged
      expect(original.email).toBe(originalEmail);
      expect(original.phoneNumber).toBe(originalPhone);
    });

    it('skips null and undefined values', () => {
      const userData = {
        userUID: 'user123',
        email: null as any,
        phoneNumber: undefined as any,
        fullName: 'John Doe',
      };

      const result = hashFields(userData, 'user');

      // Null/undefined should not be encrypted
      expect(result.email).toBeNull();
      expect(result.phoneNumber).toBeUndefined();
      expect(result.fullName).toBe(userData.fullName);
    });

    it('skips empty strings', () => {
      const userData = {
        userUID: 'user123',
        email: '',
        phoneNumber: '',
        fullName: 'John Doe',
      };

      const result = hashFields(userData, 'user');

      // Empty strings should not be encrypted
      expect(result.email).toBe('');
      expect(result.phoneNumber).toBe('');
      expect(result.fullName).toBe(userData.fullName);
    });

    it('only hashes fields defined for that entity type', () => {
      const userData = {
        email: 'test@example.com',
        addressLine1: '123 Main St', // Not a user field
      };

      const result = hashFields(userData, 'user');

      // email is a user field -> hashed
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // addressLine1 is not a user field -> not hashed
      expect(result.addressLine1).toBe('123 Main St');
    });

    it('handles objects with no hashable fields', () => {
      const data = {
        someField: 'value',
        anotherField: 123,
      };

      const result = hashFields(data, 'user');

      // Nothing should be modified
      expect(result).toEqual(data);
    });

    it('handles empty objects', () => {
      const data = {};

      const result = hashFields(data, 'user');

      expect(result).toEqual({});
    });

    it('handles non-string values in hashable fields', () => {
      const userData = {
        email: 123 as any, // Number instead of string
        phoneNumber: { value: '+61412345678' } as any, // Object instead of string
      };

      const result = hashFields(userData, 'user');

      // Non-string values should not be encrypted
      expect(result.email).toBe(123);
      expect(result.phoneNumber).toEqual({ value: '+61412345678' });
    });
  });

  describe('Integration', () => {
    it('can hash multiple entities independently', () => {
      const user = {
        email: 'user@example.com',
        phoneNumber: '+61412345678',
      };

      const contact = {
        email: 'contact@example.com',
        phoneNumber: '+61487654321',
      };

      const hashedUser = hashFields(user, 'user');
      const hashedContact = hashFields(contact, 'contact');

      // Both should be encrypted
      expect(hashedUser.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(hashedContact.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Should have different encrypted values (different IVs)
      expect(hashedUser.email).not.toBe(hashedContact.email);
    });
  });
});
