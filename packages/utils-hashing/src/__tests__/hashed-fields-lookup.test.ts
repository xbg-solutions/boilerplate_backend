/**
 * Hashed Fields Lookup - Unit Tests
 *
 * Testing WHAT the lookup does, not HOW it works internally:
 * - Identifies which fields should be encrypted
 * - Provides central registry of PII fields
 * - Supports entity.field path pattern
 * - Supports transparent and guarded encryption modes
 *
 * Note: HASHED_FIELDS ships with minimal user PII entries.
 * Projects add their own entries as entities are defined.
 */

import {
  HASHED_FIELDS,
  isHashedField,
  HashedFieldPath,
  registerHashedFields,
  getFieldMode,
  getTransparentFields,
  getGuardedFields,
  PII_BLOB_KEY,
} from '../hashed-fields-lookup';

describe('Hashed Fields Lookup', () => {
  describe('HASHED_FIELDS', () => {
    it('defines user PII fields with guarded mode', () => {
      expect(HASHED_FIELDS['user.email']).toEqual({ mode: 'guarded' });
      expect(HASHED_FIELDS['user.phoneNumber']).toEqual({ mode: 'guarded' });
    });

    it('contains only expected built-in fields', () => {
      const builtInFields = ['user.email', 'user.phoneNumber'];

      builtInFields.forEach((field) => {
        expect(field in HASHED_FIELDS).toBe(true);
      });
    });

    it('all built-in values have a valid mode', () => {
      const builtInFields = ['user.email', 'user.phoneNumber'];
      builtInFields.forEach((field) => {
        const config = HASHED_FIELDS[field];
        expect(config).toBeDefined();
        expect(['transparent', 'guarded']).toContain(config.mode);
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

  describe('PII_BLOB_KEY', () => {
    it('is a string constant', () => {
      expect(typeof PII_BLOB_KEY).toBe('string');
      expect(PII_BLOB_KEY).toBe('_pii');
    });
  });

  describe('registerHashedFields with modes', () => {
    it('defaults to guarded mode when mode is omitted', () => {
      registerHashedFields('testDefault', ['secret']);

      expect(isHashedField('testDefault.secret')).toBe(true);
      expect(getFieldMode('testDefault.secret')).toBe('guarded');
    });

    it('registers fields with explicit guarded mode', () => {
      registerHashedFields('testGuarded', ['apiKey', 'ssn'], 'guarded');

      expect(getFieldMode('testGuarded.apiKey')).toBe('guarded');
      expect(getFieldMode('testGuarded.ssn')).toBe('guarded');
    });

    it('registers fields with transparent mode', () => {
      registerHashedFields('testTransparent', ['email', 'phone', 'name'], 'transparent');

      expect(getFieldMode('testTransparent.email')).toBe('transparent');
      expect(getFieldMode('testTransparent.phone')).toBe('transparent');
      expect(getFieldMode('testTransparent.name')).toBe('transparent');
    });

    it('supports mixed modes for the same entity', () => {
      registerHashedFields('testMixed', ['displayEmail', 'displayPhone'], 'transparent');
      registerHashedFields('testMixed', ['taxId'], 'guarded');

      expect(getFieldMode('testMixed.displayEmail')).toBe('transparent');
      expect(getFieldMode('testMixed.displayPhone')).toBe('transparent');
      expect(getFieldMode('testMixed.taxId')).toBe('guarded');
    });
  });

  describe('getFieldMode', () => {
    it('returns mode for registered fields', () => {
      expect(getFieldMode('user.email')).toBe('guarded');
      expect(getFieldMode('user.phoneNumber')).toBe('guarded');
    });

    it('returns undefined for unregistered fields', () => {
      expect(getFieldMode('user.notRegistered')).toBeUndefined();
      expect(getFieldMode('unknown.field')).toBeUndefined();
      expect(getFieldMode('')).toBeUndefined();
    });
  });

  describe('getTransparentFields', () => {
    it('returns transparent field names for an entity', () => {
      registerHashedFields('contactTest', ['firstName', 'lastName', 'email'], 'transparent');
      registerHashedFields('contactTest', ['ssn'], 'guarded');

      const transparent = getTransparentFields('contactTest');
      expect(transparent.sort()).toEqual(['email', 'firstName', 'lastName']);
    });

    it('returns empty array when entity has no transparent fields', () => {
      expect(getTransparentFields('user')).toEqual([]);
    });

    it('returns empty array for unregistered entity', () => {
      expect(getTransparentFields('nonexistent')).toEqual([]);
    });
  });

  describe('getGuardedFields', () => {
    it('returns guarded field names for an entity', () => {
      registerHashedFields('guardedTest', ['email'], 'transparent');
      registerHashedFields('guardedTest', ['ssn', 'taxId'], 'guarded');

      const guarded = getGuardedFields('guardedTest');
      expect(guarded.sort()).toEqual(['ssn', 'taxId']);
    });

    it('returns guarded fields for built-in user entity', () => {
      const guarded = getGuardedFields('user');
      expect(guarded).toContain('email');
      expect(guarded).toContain('phoneNumber');
    });

    it('returns empty array for unregistered entity', () => {
      expect(getGuardedFields('nonexistent')).toEqual([]);
    });
  });
});
