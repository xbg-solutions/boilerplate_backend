/**
 * Hashed Fields Lookup - Unit Tests
 *
 * Testing WHAT the lookup does, not HOW it works internally:
 * - Identifies which fields should be encrypted
 * - Provides central registry of PII fields
 * - Supports entity.field path pattern
 *
 * Note: HASHED_FIELDS ships with minimal user PII entries.
 * Projects add their own entries as entities are defined.
 */

import { HASHED_FIELDS, isHashedField, HashedFieldPath } from '../hashed-fields-lookup';

describe('Hashed Fields Lookup', () => {
  describe('HASHED_FIELDS', () => {
    it('defines user PII fields', () => {
      expect(HASHED_FIELDS['user.email']).toBe(true);
      expect(HASHED_FIELDS['user.phoneNumber']).toBe(true);
    });

    it('contains only expected fields', () => {
      const expectedFields = [
        'user.email',
        'user.phoneNumber',
      ];

      const actualFields = Object.keys(HASHED_FIELDS);
      expect(actualFields.sort()).toEqual(expectedFields.sort());
    });

    it('has correct count of fields', () => {
      const fieldCount = Object.keys(HASHED_FIELDS).length;
      expect(fieldCount).toBe(2);
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

      it('returns false for fields from non-registered entities', () => {
        expect(isHashedField('account.email')).toBe(false);
        expect(isHashedField('profile.phoneNumber')).toBe(false);
        expect(isHashedField('organization.address')).toBe(false);
      });

      it('returns false for similar but different field names', () => {
        expect(isHashedField('user.emails')).toBe(false);
        expect(isHashedField('user.emailAddress')).toBe(false);
        expect(isHashedField('user.phone')).toBe(false);
      });
    });

    describe('type safety', () => {
      it('accepts valid HashedFieldPath types', () => {
        const validPaths: HashedFieldPath[] = [
          'user.email',
          'user.phoneNumber',
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
  });

  describe('Consistency', () => {
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
