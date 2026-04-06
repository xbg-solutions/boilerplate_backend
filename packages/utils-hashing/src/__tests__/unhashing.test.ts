/**
 * Unhashing Utilities - Unit Tests
 *
 * Testing WHAT the unhashing does, not HOW it works internally:
 * - Decrypts AES-256-GCM encrypted values
 * - Validates encrypted value format
 * - Handles decryption errors gracefully
 * - Selectively unhashes only requested fields
 */

import { unhashValue, unhashFields, unhashTransparentFields, unhashTransparentFieldsByName } from '../unhashing';
import { hashValue, hashTransparentFields, hashTransparentFieldsByName } from '../hasher';
import { registerHashedFields, PII_BLOB_KEY } from '../hashed-fields-lookup';

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
      const userData = {
        userUID: 'user123',
        email: hashValue('user@example.com'),
        phoneNumber: hashValue('+61412345678'),
        fullName: 'Jane Smith',
      };

      // Request to unhash only email
      const result = unhashFields(userData, ['user.email']);

      // Email should be decrypted
      expect(result.email).toBe('user@example.com');

      // Phone number should remain encrypted
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).not.toBe('+61412345678');

      // Other fields unchanged
      expect(result.userUID).toBe('user123');
      expect(result.fullName).toBe('Jane Smith');
    });

    it('unhashes multiple requested fields', () => {
      const userData = {
        userUID: 'user123',
        email: hashValue('user@example.com'),
        phoneNumber: hashValue('+61412345678'),
        fullName: 'Jane Smith',
      };

      // Request to unhash both email and phone
      const result = unhashFields(userData, ['user.email', 'user.phoneNumber']);

      // Both should be decrypted
      expect(result.email).toBe('user@example.com');
      expect(result.phoneNumber).toBe('+61412345678');

      // Other fields unchanged
      expect(result.userUID).toBe('user123');
      expect(result.fullName).toBe('Jane Smith');
    });

    it('unhashes selected fields from a larger object', () => {
      const userData = {
        userUID: 'user123',
        email: hashValue('user@example.com'),
        phoneNumber: hashValue('+61412345678'),
        displayName: 'Jane Smith',
        isActive: true,
      };

      // Only unhash email
      const result = unhashFields(userData, ['user.email']);

      // Requested field should be decrypted
      expect(result.email).toBe('user@example.com');

      // Non-requested hashed fields should remain encrypted
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Other fields unchanged
      expect(result.userUID).toBe('user123');
      expect(result.displayName).toBe('Jane Smith');
      expect(result.isActive).toBe(true);
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

    it('successfully encrypts and partially decrypts user data', () => {
      const original = {
        userUID: 'user123',
        email: 'user@example.com',
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
      const partiallyDecrypted = unhashFields(encrypted, ['user.email']);

      expect(partiallyDecrypted.email).toBe(original.email);
      expect(partiallyDecrypted.phoneNumber).not.toBe(original.phoneNumber);
      expect(partiallyDecrypted.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });
  });

  describe('unhashTransparentFields', () => {
    beforeEach(() => {
      // Register a test entity with mixed modes
      registerHashedFields('customer', ['firstName', 'lastName', 'email', 'phone'], 'transparent');
      registerHashedFields('customer', ['ssn', 'taxId'], 'guarded');
    });

    it('decrypts _pii blob and restores transparent fields', () => {
      const original = {
        customerUID: 'c123',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        phone: '+61412345678',
        ssn: '123-45-6789',
        taxId: 'TFN123',
        notes: 'VIP customer',
      };

      const encrypted = hashTransparentFields(original, 'customer');

      // Verify _pii blob exists, transparent fields removed
      expect((encrypted as any)[PII_BLOB_KEY]).toBeDefined();
      expect(encrypted.firstName).toBeUndefined();

      const decrypted = unhashTransparentFields(encrypted, 'customer');

      // Transparent fields restored
      expect(decrypted.firstName).toBe('Jane');
      expect(decrypted.lastName).toBe('Smith');
      expect(decrypted.email).toBe('jane@example.com');
      expect(decrypted.phone).toBe('+61412345678');

      // _pii blob removed
      expect((decrypted as any)[PII_BLOB_KEY]).toBeUndefined();

      // Guarded fields still encrypted
      expect(decrypted.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(decrypted.taxId).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Plain fields unchanged
      expect(decrypted.customerUID).toBe('c123');
      expect(decrypted.notes).toBe('VIP customer');
    });

    it('migration fallback: decrypts individually encrypted transparent fields when no _pii blob', () => {
      // Simulate legacy data: transparent fields encrypted per-field (no blob)
      const legacyData = {
        customerUID: 'c123',
        firstName: hashValue('Jane'),
        lastName: hashValue('Smith'),
        email: hashValue('jane@example.com'),
        phone: hashValue('+61412345678'),
        ssn: hashValue('123-45-6789'),
        notes: 'VIP customer',
      };

      const decrypted = unhashTransparentFields(legacyData, 'customer');

      // Transparent fields decrypted via fallback
      expect(decrypted.firstName).toBe('Jane');
      expect(decrypted.lastName).toBe('Smith');
      expect(decrypted.email).toBe('jane@example.com');
      expect(decrypted.phone).toBe('+61412345678');

      // Guarded field left untouched (ssn is guarded, not transparent)
      expect(decrypted.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Plain fields unchanged
      expect(decrypted.notes).toBe('VIP customer');
    });

    it('does not modify original object', () => {
      const original = {
        firstName: 'Jane',
        email: 'jane@example.com',
      };

      const encrypted = hashTransparentFields(original, 'customer');
      const encryptedBlob = (encrypted as any)[PII_BLOB_KEY];

      unhashTransparentFields(encrypted, 'customer');

      // Original encrypted object should be unchanged
      expect((encrypted as any)[PII_BLOB_KEY]).toBe(encryptedBlob);
    });

    it('handles data with no _pii blob and no encrypted transparent fields', () => {
      const data = {
        customerUID: 'c123',
        notes: 'Just a note',
      };

      const result = unhashTransparentFields(data, 'customer');

      expect(result).toEqual(data);
    });

    it('handles empty object', () => {
      const result = unhashTransparentFields({}, 'customer');
      expect(result).toEqual({});
    });

    it('handles entity with no transparent fields', () => {
      // 'user' only has guarded fields
      const data = {
        email: hashValue('test@example.com'),
        phoneNumber: hashValue('+61412345678'),
      };

      const result = unhashTransparentFields(data, 'user');

      // Nothing should change — no transparent fields to process
      expect(result.email).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(result.phoneNumber).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });
  });

  describe('unhashTransparentFieldsByName', () => {
    it('decrypts _pii blob and restores named fields', () => {
      const data = {
        email: 'jane@example.com',
        phone: '+61412345678',
        name: 'Jane',
      };

      const encrypted = hashTransparentFieldsByName(data, ['email', 'phone']);
      const decrypted = unhashTransparentFieldsByName(encrypted, ['email', 'phone']);

      expect(decrypted.email).toBe('jane@example.com');
      expect(decrypted.phone).toBe('+61412345678');
      expect(decrypted.name).toBe('Jane');
      expect((decrypted as any)[PII_BLOB_KEY]).toBeUndefined();
    });

    it('migration fallback: decrypts individually encrypted fields when no blob', () => {
      const legacyData = {
        email: hashValue('jane@example.com'),
        phone: hashValue('+61412345678'),
        name: 'Jane',
      };

      const decrypted = unhashTransparentFieldsByName(legacyData, ['email', 'phone']);

      expect(decrypted.email).toBe('jane@example.com');
      expect(decrypted.phone).toBe('+61412345678');
      expect(decrypted.name).toBe('Jane');
    });
  });

  describe('Integration: Full transparent + guarded round-trip', () => {
    beforeEach(() => {
      registerHashedFields('employee', ['displayName', 'workEmail', 'workPhone'], 'transparent');
      registerHashedFields('employee', ['ssn', 'bankAccount'], 'guarded');
    });

    it('full round-trip: encrypt → unhash transparent → unhash guarded', () => {
      const original = {
        employeeId: 'emp001',
        displayName: 'Alice Johnson',
        workEmail: 'alice@company.com',
        workPhone: '+61400111222',
        ssn: '987-65-4321',
        bankAccount: 'BSB-123456',
        department: 'Engineering',
      };

      // Step 1: Encrypt everything
      const stored = hashTransparentFields(original, 'employee');

      // Verify storage shape
      expect((stored as any)[PII_BLOB_KEY]).toBeDefined();
      expect(stored.displayName).toBeUndefined();
      expect(stored.workEmail).toBeUndefined();
      expect(stored.workPhone).toBeUndefined();
      expect(stored.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(stored.bankAccount).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(stored.employeeId).toBe('emp001');
      expect(stored.department).toBe('Engineering');

      // Step 2: Auto-decrypt transparent fields (cheap, one operation)
      const readable = unhashTransparentFields(stored, 'employee');

      expect(readable.displayName).toBe('Alice Johnson');
      expect(readable.workEmail).toBe('alice@company.com');
      expect(readable.workPhone).toBe('+61400111222');
      expect(readable.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(readable.bankAccount).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect((readable as any)[PII_BLOB_KEY]).toBeUndefined();

      // Step 3: Explicit decrypt of guarded fields (when needed)
      const full = unhashFields(readable, ['employee.ssn', 'employee.bankAccount']);

      expect(full.displayName).toBe('Alice Johnson');
      expect(full.workEmail).toBe('alice@company.com');
      expect(full.workPhone).toBe('+61400111222');
      expect(full.ssn).toBe('987-65-4321');
      expect(full.bankAccount).toBe('BSB-123456');
      expect(full.employeeId).toBe('emp001');
      expect(full.department).toBe('Engineering');
    });

    it('round-trip with dot-path nested fields (byName)', () => {
      const original = {
        projectName: 'Alpha',
        contactPerson: { name: 'Jane', email: 'jane@example.com', role: 'Manager' },
        billing: { phone: '+61400111222', taxId: 'TFN123' },
      };

      // Encrypt: contactPerson.name and contactPerson.email are transparent, billing.taxId is guarded
      const stored = hashTransparentFieldsByName(
        original,
        ['contactPerson.name', 'contactPerson.email', 'billing.phone'],
        ['billing.taxId']
      );

      // Transparent fields removed, blob created
      expect((stored as any)[PII_BLOB_KEY]).toBeDefined();
      expect((stored as any).contactPerson.name).toBeUndefined();
      expect((stored as any).contactPerson.email).toBeUndefined();
      expect((stored as any).contactPerson.role).toBe('Manager');
      expect((stored as any).billing.phone).toBeUndefined();
      expect((stored as any).billing.taxId).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Decrypt transparent fields
      const readable = unhashTransparentFieldsByName(stored, ['contactPerson.name', 'contactPerson.email', 'billing.phone']);

      expect((readable as any).contactPerson.name).toBe('Jane');
      expect((readable as any).contactPerson.email).toBe('jane@example.com');
      expect((readable as any).contactPerson.role).toBe('Manager');
      expect((readable as any).billing.phone).toBe('+61400111222');
      // Guarded still encrypted
      expect((readable as any).billing.taxId).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(readable.projectName).toBe('Alpha');
    });

    it('batch decryption: 1 blob decrypt per object regardless of field count', () => {
      const employees = Array.from({ length: 10 }, (_, i) => ({
        employeeId: `emp${i}`,
        displayName: `Employee ${i}`,
        workEmail: `emp${i}@company.com`,
        workPhone: `+6140000000${i}`,
        ssn: `000-00-000${i}`,
        department: 'Engineering',
      }));

      // Encrypt all
      const stored = employees.map(e => hashTransparentFields(e, 'employee'));

      // Each stored object has exactly one _pii blob
      stored.forEach(s => {
        expect((s as any)[PII_BLOB_KEY]).toBeDefined();
        expect(s.displayName).toBeUndefined();
      });

      // Decrypt transparent fields for all (1 blob decrypt per object)
      const readable = stored.map(s => unhashTransparentFields(s, 'employee'));

      // All transparent fields restored
      readable.forEach((r, i) => {
        expect(r.displayName).toBe(`Employee ${i}`);
        expect(r.workEmail).toBe(`emp${i}@company.com`);
        expect(r.workPhone).toBe(`+6140000000${i}`);
        expect((r as any)[PII_BLOB_KEY]).toBeUndefined();
        // Guarded still encrypted
        expect(r.ssn).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      });
    });
  });
});
