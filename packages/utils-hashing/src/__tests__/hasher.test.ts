/**
 * Hasher Utilities - Unit Tests
 *
 * Testing WHAT the hasher does, not HOW it works internally:
 * - Encrypts values using AES-256-GCM
 * - Produces different encrypted values for same input (random IV)
 * - Handles edge cases (empty strings, nulls, etc.)
 * - Validates encryption key requirements
 */

import { hashValue, hashFields, hashTransparentFields, hashTransparentFieldsByName } from '../hasher';
import { registerHashedFields, PII_BLOB_KEY } from '../hashed-fields-lookup';
import { unhashValue } from '../unhashing';

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

    it('hashes user entity fields with multiple data objects', () => {
      const userData2 = {
        userUID: 'user456',
        email: 'another@example.com',
        phoneNumber: '+61487654321',
        displayName: 'Jane Smith',
      };

      const result = hashFields(userData2, 'user');

      // Hashed fields should be encrypted
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed fields should remain unchanged
      expect(result.userUID).toBe(userData2.userUID);
      expect(result.displayName).toBe(userData2.displayName);
    });

    it('does not hash fields for unregistered entity types', () => {
      const unknownData = {
        email: 'unknown@example.com',
        phoneNumber: '+61412345678',
        isDefault: true,
      };

      const result = hashFields(unknownData, 'unknown_entity' as any);

      // No fields should be encrypted for an unregistered entity
      expect(result.email).toBe('unknown@example.com');
      expect(result.phoneNumber).toBe('+61412345678');
      expect(result.isDefault).toBe(true);
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
    it('can hash same entity type independently with different values', () => {
      const user1 = {
        email: 'user1@example.com',
        phoneNumber: '+61412345678',
      };

      const user2 = {
        email: 'user2@example.com',
        phoneNumber: '+61487654321',
      };

      const hashedUser1 = hashFields(user1, 'user');
      const hashedUser2 = hashFields(user2, 'user');

      // Both should be encrypted
      expect(hashedUser1.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(hashedUser2.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Should have different encrypted values (different IVs)
      expect(hashedUser1.email).not.toBe(hashedUser2.email);
    });
  });

  describe('hashTransparentFields', () => {
    beforeEach(() => {
      // Register a test entity with mixed modes
      registerHashedFields('client', ['firstName', 'lastName', 'email', 'phone'], 'transparent');
      registerHashedFields('client', ['ssn', 'taxFileNumber'], 'guarded');
    });

    it('bundles transparent fields into a _pii blob', () => {
      const data = {
        clientUID: 'c123',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        phone: '+61412345678',
        ssn: '123-45-6789',
        taxFileNumber: '12345678',
        notes: 'Some notes',
      };

      const result = hashTransparentFields(data, 'client');

      // Transparent fields should be removed from the result
      expect(result.firstName).toBeUndefined();
      expect(result.lastName).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.phone).toBeUndefined();

      // _pii blob should exist and be encrypted
      expect((result as any)[PII_BLOB_KEY]).toBeDefined();
      expect((result as any)[PII_BLOB_KEY]).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Guarded fields should be encrypted individually
      expect(result.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.taxFileNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed fields should be unchanged
      expect(result.clientUID).toBe('c123');
      expect(result.notes).toBe('Some notes');
    });

    it('decrypting the _pii blob restores transparent fields', () => {
      const data = {
        firstName: 'Jane',
        email: 'jane@example.com',
        phone: '+61412345678',
      };

      const result = hashTransparentFields(data, 'client');
      const blob = (result as any)[PII_BLOB_KEY] as string;
      const decryptedJson = unhashValue(blob);
      const fields = JSON.parse(decryptedJson);

      expect(fields.firstName).toBe('Jane');
      expect(fields.email).toBe('jane@example.com');
      expect(fields.phone).toBe('+61412345678');
    });

    it('does not modify original object', () => {
      const original = {
        firstName: 'Jane',
        email: 'jane@example.com',
        ssn: '123-45-6789',
      };

      const originalFirstName = original.firstName;
      const originalEmail = original.email;

      hashTransparentFields(original, 'client');

      expect(original.firstName).toBe(originalFirstName);
      expect(original.email).toBe(originalEmail);
    });

    it('skips null/undefined/empty transparent fields in the blob', () => {
      const data = {
        firstName: null as any,
        lastName: undefined as any,
        email: '',
        phone: '+61412345678',
      };

      const result = hashTransparentFields(data, 'client');

      // Only phone should be in the blob
      const blob = (result as any)[PII_BLOB_KEY] as string;
      const decryptedJson = unhashValue(blob);
      const fields = JSON.parse(decryptedJson);

      expect(fields).toEqual({ phone: '+61412345678' });
    });

    it('does not create _pii blob when no transparent fields have values', () => {
      const data = {
        clientUID: 'c123',
        ssn: '123-45-6789',
      };

      const result = hashTransparentFields(data, 'client');

      expect((result as any)[PII_BLOB_KEY]).toBeUndefined();
      expect(result.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.clientUID).toBe('c123');
    });

    it('handles entity with no transparent fields (only guarded)', () => {
      // 'user' entity has only guarded fields
      const data = {
        email: 'test@example.com',
        phoneNumber: '+61412345678',
        fullName: 'John Doe',
      };

      const result = hashTransparentFields(data, 'user');

      // No _pii blob
      expect((result as any)[PII_BLOB_KEY]).toBeUndefined();

      // Guarded fields encrypted individually
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed fields unchanged
      expect(result.fullName).toBe('John Doe');
    });

    it('handles empty object', () => {
      const result = hashTransparentFields({}, 'client');
      expect(result).toEqual({});
    });
  });

  describe('hashTransparentFieldsByName', () => {
    it('bundles transparent fields and encrypts guarded fields', () => {
      const data = {
        email: 'jane@example.com',
        phone: '+61412345678',
        ssn: '123-45-6789',
        name: 'Jane',
      };

      const result = hashTransparentFieldsByName(
        data,
        ['email', 'phone'],
        ['ssn']
      );

      // Transparent fields removed, _pii blob created
      expect(result.email).toBeUndefined();
      expect(result.phone).toBeUndefined();
      expect((result as any)[PII_BLOB_KEY]).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Guarded encrypted individually
      expect(result.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Non-hashed unchanged
      expect(result.name).toBe('Jane');
    });

    it('works without guarded fields parameter', () => {
      const data = { email: 'jane@example.com', name: 'Jane' };
      const result = hashTransparentFieldsByName(data, ['email']);

      expect(result.email).toBeUndefined();
      expect((result as any)[PII_BLOB_KEY]).toBeDefined();
      expect(result.name).toBe('Jane');
    });

    it('handles dot-path transparent fields in nested objects', () => {
      const data = {
        projectName: 'Alpha',
        contactPerson: { name: 'Jane', email: 'jane@example.com', role: 'Manager' },
      };

      const result = hashTransparentFieldsByName(
        data,
        ['contactPerson.name', 'contactPerson.email']
      );

      // Dot-path fields removed from nested object, blob created
      expect((result as any)[PII_BLOB_KEY]).toBeDefined();
      expect((result as any).contactPerson.role).toBe('Manager');
      expect((result as any).contactPerson.name).toBeUndefined();
      expect((result as any).contactPerson.email).toBeUndefined();

      // Blob contains the dot-path keys
      const blob = (result as any)[PII_BLOB_KEY] as string;
      const decryptedJson = unhashValue(blob);
      const fields = JSON.parse(decryptedJson);
      expect(fields['contactPerson.name']).toBe('Jane');
      expect(fields['contactPerson.email']).toBe('jane@example.com');

      // Non-encrypted fields unchanged
      expect(result.projectName).toBe('Alpha');
    });

    it('handles mixed flat and dot-path fields', () => {
      const data = {
        email: 'top@example.com',
        billing: { phone: '+61400111222', taxId: '123' },
        notes: 'Test',
      };

      const result = hashTransparentFieldsByName(
        data,
        ['email', 'billing.phone'],
        ['billing.taxId']
      );

      // Transparent fields in blob
      expect(result.email).toBeUndefined();
      expect((result as any).billing.phone).toBeUndefined();
      expect((result as any)[PII_BLOB_KEY]).toBeDefined();

      // Guarded field encrypted individually
      expect((result as any).billing.taxId).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      expect(result.notes).toBe('Test');
    });

    it('does not modify original nested objects', () => {
      const original = {
        contact: { email: 'jane@example.com', role: 'Manager' },
      };

      const originalEmail = original.contact.email;
      hashTransparentFieldsByName(original, ['contact.email']);

      expect(original.contact.email).toBe(originalEmail);
    });
  });
});
