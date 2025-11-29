/**
 * Hashed Fields Lookup - Unit Tests
 *
 * Testing WHAT the lookup does, not HOW it works internally:
 * - Identifies which fields should be encrypted
 * - Provides central registry of PII fields
 * - Supports multiple entity types
 */

import { HASHED_FIELDS, isHashedField, HashedFieldPath } from '../hashed-fields-lookup';

describe('Hashed Fields Lookup', () => {
  describe('HASHED_FIELDS', () => {
    it('defines user PII fields', () => {
      expect(HASHED_FIELDS['user.email']).toBe(true);
      expect(HASHED_FIELDS['user.phoneNumber']).toBe(true);
    });

    it('defines contact PII fields', () => {
      expect(HASHED_FIELDS['contact.email']).toBe(true);
      expect(HASHED_FIELDS['contact.phoneNumber']).toBe(true);
    });

    it('defines address PII fields', () => {
      expect(HASHED_FIELDS['address.addressLine1']).toBe(true);
      expect(HASHED_FIELDS['address.addressLine2']).toBe(true);
      expect(HASHED_FIELDS['address.city']).toBe(true);
      expect(HASHED_FIELDS['address.state']).toBe(true);
      expect(HASHED_FIELDS['address.postalCode']).toBe(true);
      expect(HASHED_FIELDS['address.country']).toBe(true);
    });

    it('contains only expected fields', () => {
      const expectedFields = [
        'user.email',
        'user.phoneNumber',
        'contact.email',
        'contact.phoneNumber',
        'address.addressLine1',
        'address.addressLine2',
        'address.city',
        'address.state',
        'address.postalCode',
        'address.country',
      ];

      const actualFields = Object.keys(HASHED_FIELDS);
      expect(actualFields.sort()).toEqual(expectedFields.sort());
    });

    it('has correct count of fields', () => {
      const fieldCount = Object.keys(HASHED_FIELDS).length;
      expect(fieldCount).toBe(10); // 2 user + 2 contact + 6 address
    });

    it('all values are true', () => {
      Object.values(HASHED_FIELDS).forEach((value) => {
        expect(value).toBe(true);
      });
    });
  });

  describe('isHashedField', () => {
    describe('user fields', () => {
      it('returns true for user.email', () => {
        expect(isHashedField('user.email')).toBe(true);
      });

      it('returns true for user.phoneNumber', () => {
        expect(isHashedField('user.phoneNumber')).toBe(true);
      });

      it('returns false for non-hashed user fields', () => {
        expect(isHashedField('user.userUID')).toBe(false);
        expect(isHashedField('user.fullName')).toBe(false);
        expect(isHashedField('user.createdAt')).toBe(false);
        expect(isHashedField('user.isDeleted')).toBe(false);
      });
    });

    describe('contact fields', () => {
      it('returns true for contact.email', () => {
        expect(isHashedField('contact.email')).toBe(true);
      });

      it('returns true for contact.phoneNumber', () => {
        expect(isHashedField('contact.phoneNumber')).toBe(true);
      });

      it('returns false for non-hashed contact fields', () => {
        expect(isHashedField('contact.contactUID')).toBe(false);
        expect(isHashedField('contact.fullName')).toBe(false);
        expect(isHashedField('contact.createdAt')).toBe(false);
      });
    });

    describe('address fields', () => {
      it('returns true for all address PII fields', () => {
        expect(isHashedField('address.addressLine1')).toBe(true);
        expect(isHashedField('address.addressLine2')).toBe(true);
        expect(isHashedField('address.city')).toBe(true);
        expect(isHashedField('address.state')).toBe(true);
        expect(isHashedField('address.postalCode')).toBe(true);
        expect(isHashedField('address.country')).toBe(true);
      });

      it('returns false for non-hashed address fields', () => {
        expect(isHashedField('address.addressUID')).toBe(false);
        expect(isHashedField('address.isDefault')).toBe(false);
        expect(isHashedField('address.createdAt')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('returns false for empty string', () => {
        expect(isHashedField('')).toBe(false);
      });

      it('returns false for invalid field paths', () => {
        expect(isHashedField('invalid')).toBe(false);
        expect(isHashedField('invalid.field')).toBe(false);
        expect(isHashedField('user')).toBe(false);
        expect(isHashedField('.email')).toBe(false);
        expect(isHashedField('user.')).toBe(false);
      });

      it('returns false for fields with too many parts', () => {
        expect(isHashedField('user.email.extra')).toBe(false);
        expect(isHashedField('user.email.extra.parts')).toBe(false);
      });

      it('is case sensitive', () => {
        expect(isHashedField('User.Email')).toBe(false);
        expect(isHashedField('USER.EMAIL')).toBe(false);
        expect(isHashedField('user.Email')).toBe(false);
      });

      it('returns false for fields from non-existent entities', () => {
        expect(isHashedField('account.email')).toBe(false);
        expect(isHashedField('profile.phoneNumber')).toBe(false);
        expect(isHashedField('organization.address')).toBe(false);
      });

      it('returns false for similar but different field names', () => {
        expect(isHashedField('user.emails')).toBe(false); // Plural
        expect(isHashedField('user.emailAddress')).toBe(false); // Different name
        expect(isHashedField('user.phone')).toBe(false); // Shortened
        expect(isHashedField('address.address')).toBe(false); // Missing Line1
        expect(isHashedField('address.postalcode')).toBe(false); // Missing capital C
      });
    });

    describe('type safety', () => {
      it('accepts valid HashedFieldPath types', () => {
        const validPaths: HashedFieldPath[] = [
          'user.email',
          'user.phoneNumber',
          'contact.email',
          'contact.phoneNumber',
          'address.addressLine1',
          'address.addressLine2',
          'address.city',
          'address.state',
          'address.postalCode',
          'address.country',
        ];

        validPaths.forEach((path) => {
          expect(isHashedField(path)).toBe(true);
        });
      });
    });
  });

  describe('Coverage of entity types', () => {
    it('supports user entity', () => {
      const userFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('user.')
      );

      expect(userFields.length).toBeGreaterThan(0);
    });

    it('supports contact entity', () => {
      const contactFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('contact.')
      );

      expect(contactFields.length).toBeGreaterThan(0);
    });

    it('supports address entity', () => {
      const addressFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('address.')
      );

      expect(addressFields.length).toBeGreaterThan(0);
    });

    it('has most fields in address entity', () => {
      const userFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('user.')
      ).length;
      const contactFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('contact.')
      ).length;
      const addressFields = Object.keys(HASHED_FIELDS).filter((key) =>
        key.startsWith('address.')
      ).length;

      // Address has 6 fields, user and contact each have 2
      expect(addressFields).toBeGreaterThan(userFields);
      expect(addressFields).toBeGreaterThan(contactFields);
    });
  });

  describe('Consistency', () => {
    it('user and contact have same field types', () => {
      const userFields = Object.keys(HASHED_FIELDS)
        .filter((key) => key.startsWith('user.'))
        .map((key) => key.split('.')[1])
        .sort();

      const contactFields = Object.keys(HASHED_FIELDS)
        .filter((key) => key.startsWith('contact.'))
        .map((key) => key.split('.')[1])
        .sort();

      // Both should have email and phoneNumber
      expect(userFields).toEqual(contactFields);
    });

    it('all field paths follow entity.field pattern', () => {
      Object.keys(HASHED_FIELDS).forEach((fieldPath) => {
        const parts = fieldPath.split('.');
        expect(parts.length).toBe(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
      });
    });

    it('no duplicate field paths', () => {
      const paths = Object.keys(HASHED_FIELDS);
      const uniquePaths = [...new Set(paths)];

      expect(paths.length).toBe(uniquePaths.length);
    });
  });
});
