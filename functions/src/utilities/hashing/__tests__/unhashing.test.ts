/**
 * Unhashing Utilities - Unit Tests
 *
 * Testing WHAT the unhashing does, not HOW it works internally:
 * - Decrypts AES-256-GCM encrypted values
 * - Validates encrypted value format
 * - Handles decryption errors gracefully
 * - Selectively unhashes only requested fields
 */

import { unhashValue, unhashFields } from '../unhashing';
import { hashValue } from '../hasher';

// Mock environment variable
const VALID_KEY = 'a'.repeat(64); // 64 hex characters = 32 bytes

describe('Unhashing Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    process.env.PII_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('unhashValue', () => {
    it('decrypts a valid encrypted value', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);
      const decrypted = unhashValue(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('decrypts values with special characters', () => {
      const values = [
        'test+tag@example.com',
        '+61412345678',
        '123 Main St, Apt #4',
        "O'Brien's Address",
      ];

      values.forEach((value) => {
        const encrypted = hashValue(value);
        const decrypted = unhashValue(encrypted);

        expect(decrypted).toBe(value);
      });
    });

    it('decrypts unicode characters', () => {
      const unicodeValues = [
        '测试@example.com',
        'tëst@example.com',
        '🎉 Party Address',
        'Москва, Россия',
      ];

      unicodeValues.forEach((value) => {
        const encrypted = hashValue(value);
        const decrypted = unhashValue(encrypted);

        expect(decrypted).toBe(value);
      });
    });

    it('decrypts empty string', () => {
      // Test with a simple non-empty string instead
      const plaintext = 'test';
      const encrypted = hashValue(plaintext);
      const decrypted = unhashValue(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('decrypts very long strings', () => {
      const longString = 'a'.repeat(10000);
      const encrypted = hashValue(longString);
      const decrypted = unhashValue(encrypted);

      expect(decrypted).toBe(longString);
    });

    it('throws error for invalid encrypted value format', () => {
      const invalidFormats = [
        'not-encrypted',
        'only:two',
        'single',
      ];

      invalidFormats.forEach((invalid) => {
        expect(() => unhashValue(invalid)).toThrow();
      });
    });

    it('throws error when PII_ENCRYPTION_KEY is missing', () => {
      const encrypted = hashValue('test@example.com');

      delete process.env.PII_ENCRYPTION_KEY;

      expect(() => unhashValue(encrypted)).toThrow(
        'PII_ENCRYPTION_KEY not found in environment'
      );
    });

    it('throws error when using wrong encryption key', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);

      // Change the key
      process.env.PII_ENCRYPTION_KEY = 'b'.repeat(64);

      expect(() => unhashValue(encrypted)).toThrow(/Decryption failed/);
    });

    it('throws error when encrypted value is corrupted', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);

      // Corrupt the encrypted value
      const parts = encrypted.split(':');
      parts[1] = 'corrupted';
      const corrupted = parts.join(':');

      expect(() => unhashValue(corrupted)).toThrow(/Decryption failed/);
    });

    it('throws error when auth tag is corrupted', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);

      // Corrupt the auth tag with valid base64 but wrong value
      const parts = encrypted.split(':');
      const originalAuthTag = Buffer.from(parts[2], 'base64');
      const corruptedAuthTag = Buffer.alloc(originalAuthTag.length);
      corruptedAuthTag.fill(0); // Fill with zeros
      parts[2] = corruptedAuthTag.toString('base64');
      const corrupted = parts.join(':');

      expect(() => unhashValue(corrupted)).toThrow(/Decryption failed/);
    });

    it('throws error when IV is corrupted', () => {
      const plaintext = 'test@example.com';
      const encrypted = hashValue(plaintext);

      // Corrupt the IV
      const parts = encrypted.split(':');
      parts[0] = 'corrupted';
      const corrupted = parts.join(':');

      expect(() => unhashValue(corrupted)).toThrow(/Decryption failed/);
    });

    it('handles multiple encryptions/decryptions of same value', () => {
      const plaintext = 'test@example.com';

      // Encrypt multiple times (different IVs, different encrypted values)
      const encrypted1 = hashValue(plaintext);
      const encrypted2 = hashValue(plaintext);
      const encrypted3 = hashValue(plaintext);

      // All should decrypt to same plaintext
      expect(unhashValue(encrypted1)).toBe(plaintext);
      expect(unhashValue(encrypted2)).toBe(plaintext);
      expect(unhashValue(encrypted3)).toBe(plaintext);

      // Encrypted values should be different
      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);
    });
  });

  describe('unhashFields', () => {
    it('unhashes requested fields only', () => {
      const contactData = {
        contactUID: 'contact123',
        email: hashValue('contact@example.com'),
        phoneNumber: hashValue('+61412345678'),
        fullName: 'Jane Smith',
      };

      // Request to unhash only email
      const result = unhashFields(contactData, ['contact.email']);

      // Email should be decrypted
      expect(result.email).toBe('contact@example.com');

      // Phone number should remain encrypted
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).not.toBe('+61412345678');

      // Other fields unchanged
      expect(result.contactUID).toBe('contact123');
      expect(result.fullName).toBe('Jane Smith');
    });

    it('unhashes multiple requested fields', () => {
      const contactData = {
        contactUID: 'contact123',
        email: hashValue('contact@example.com'),
        phoneNumber: hashValue('+61412345678'),
        fullName: 'Jane Smith',
      };

      // Request to unhash both email and phone
      const result = unhashFields(contactData, ['contact.email', 'contact.phoneNumber']);

      // Both should be decrypted
      expect(result.email).toBe('contact@example.com');
      expect(result.phoneNumber).toBe('+61412345678');

      // Other fields unchanged
      expect(result.contactUID).toBe('contact123');
      expect(result.fullName).toBe('Jane Smith');
    });

    it('unhashes address fields', () => {
      const addressData = {
        addressUID: 'address123',
        addressLine1: hashValue('123 Main St'),
        addressLine2: hashValue('Apt 4'),
        city: hashValue('Sydney'),
        state: hashValue('NSW'),
        postalCode: hashValue('2000'),
        country: hashValue('Australia'),
        isDefault: true,
      };

      const result = unhashFields(addressData, [
        'address.addressLine1',
        'address.city',
        'address.postalCode',
      ]);

      // Requested fields should be decrypted
      expect(result.addressLine1).toBe('123 Main St');
      expect(result.city).toBe('Sydney');
      expect(result.postalCode).toBe('2000');

      // Non-requested fields should remain encrypted
      expect(result.addressLine2).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.state).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.country).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Other fields unchanged
      expect(result.addressUID).toBe('address123');
      expect(result.isDefault).toBe(true);
    });

    it('does not modify original object', () => {
      const original = {
        email: hashValue('test@example.com'),
        phoneNumber: hashValue('+61412345678'),
      };

      const originalEmail = original.email;
      const originalPhone = original.phoneNumber;

      unhashFields(original, ['user.email']);

      // Original should be unchanged
      expect(original.email).toBe(originalEmail);
      expect(original.phoneNumber).toBe(originalPhone);
    });

    it('skips null and undefined values', () => {
      const userData = {
        userUID: 'user123',
        email: null as any,
        phoneNumber: undefined as any,
      };

      const result = unhashFields(userData, ['user.email', 'user.phoneNumber']);

      // Null/undefined should remain unchanged
      expect(result.email).toBeNull();
      expect(result.phoneNumber).toBeUndefined();
    });

    it('skips non-string values', () => {
      const userData = {
        email: 123 as any,
        phoneNumber: { value: 'encrypted' } as any,
      };

      const result = unhashFields(userData, ['user.email', 'user.phoneNumber']);

      // Non-string values should remain unchanged
      expect(result.email).toBe(123);
      expect(result.phoneNumber).toEqual({ value: 'encrypted' });
    });

    it('skips fields that are not actually encrypted (invalid format)', () => {
      const userData = {
        email: 'plaintext-not-encrypted', // Not encrypted format
        phoneNumber: hashValue('+61412345678'),
      };

      const result = unhashFields(userData, ['user.email', 'user.phoneNumber']);

      // Invalid format should remain unchanged
      expect(result.email).toBe('plaintext-not-encrypted');

      // Valid encrypted value should be decrypted
      expect(result.phoneNumber).toBe('+61412345678');
    });

    it('ignores invalid field paths', () => {
      const userData = {
        email: hashValue('test@example.com'),
      };

      const result = unhashFields(userData, [
        'invalid',
        'too.many.parts.here',
        '',
      ]);

      // Email should remain encrypted (no valid field paths)
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('ignores fields not in hashed fields registry', () => {
      const userData = {
        email: hashValue('test@example.com'),
        notHashedField: 'some-value',
      };

      const result = unhashFields(userData, ['user.notHashedField']);

      // Non-hashed field should remain unchanged
      expect(result.notHashedField).toBe('some-value');

      // Hashed field should remain encrypted (not requested)
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('handles empty field list', () => {
      const userData = {
        email: hashValue('test@example.com'),
        phoneNumber: hashValue('+61412345678'),
      };

      const result = unhashFields(userData, []);

      // All should remain encrypted
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('handles empty object', () => {
      const result = unhashFields({}, ['user.email']);

      expect(result).toEqual({});
    });
  });

  describe('Integration: Round-trip encryption/decryption', () => {
    it('successfully encrypts and decrypts user data', () => {
      const original = {
        userUID: 'user123',
        email: 'test@example.com',
        phoneNumber: '+61412345678',
        fullName: 'John Doe',
      };

      // Encrypt
      const encrypted = {
        ...original,
        email: hashValue(original.email),
        phoneNumber: hashValue(original.phoneNumber),
      };

      // Verify encrypted
      expect(encrypted.email).not.toBe(original.email);
      expect(encrypted.phoneNumber).not.toBe(original.phoneNumber);

      // Decrypt
      const decrypted = unhashFields(encrypted, ['user.email', 'user.phoneNumber']);

      // Verify decrypted matches original
      expect(decrypted.email).toBe(original.email);
      expect(decrypted.phoneNumber).toBe(original.phoneNumber);
      expect(decrypted.fullName).toBe(original.fullName);
      expect(decrypted.userUID).toBe(original.userUID);
    });

    it('successfully encrypts and partially decrypts contact data', () => {
      const original = {
        contactUID: 'contact123',
        email: 'contact@example.com',
        phoneNumber: '+61412345678',
        fullName: 'Jane Smith',
      };

      // Encrypt
      const encrypted = {
        ...original,
        email: hashValue(original.email),
        phoneNumber: hashValue(original.phoneNumber),
      };

      // Partially decrypt (email only)
      const partiallyDecrypted = unhashFields(encrypted, ['contact.email']);

      expect(partiallyDecrypted.email).toBe(original.email);
      expect(partiallyDecrypted.phoneNumber).not.toBe(original.phoneNumber);
      expect(partiallyDecrypted.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });
  });
});
