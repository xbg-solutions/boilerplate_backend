/**
 * Validation Utilities Tests
 */

import {
  validateEmail,
  validatePhone,
  validateIANATimezone,
  validateCurrency,
  validateLength,
  validateUID,
  validateCountryCode,
  validateURL,
  validatePositiveNumber,
  validateNonNegativeNumber,
  validateFutureDate,
  validateEnum,
  EMAIL_REGEX,
  PHONE_REGEX,
  UID_REGEX,
  COUNTRY_CODE_REGEX,
} from '../validators';

describe('Validation Utilities', () => {
  describe('validateEmail', () => {
    it('should validate correct email addresses', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test.user@example.com')).toBe(true);
      expect(validateEmail('user+tag@example.co.uk')).toBe(true);
      expect(validateEmail('user_name@example-domain.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('invalid@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('user @example.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateEmail(null as any)).toBe(false);
      expect(validateEmail(undefined as any)).toBe(false);
      expect(validateEmail(123 as any)).toBe(false);
    });

    it('should trim whitespace', () => {
      expect(validateEmail('  user@example.com  ')).toBe(true);
    });
  });

  describe('validatePhone', () => {
    it('should validate correct phone numbers (E.164 format)', () => {
      expect(validatePhone('+61412345678')).toBe(true);
      expect(validatePhone('+14155552671')).toBe(true);
      expect(validatePhone('+442071234567')).toBe(true);
      expect(validatePhone('+8613812345678')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(validatePhone('0412345678')).toBe(false); // Missing country code
      expect(validatePhone('1234')).toBe(false); // Too short
      expect(validatePhone('+1234')).toBe(false); // Too short
      expect(validatePhone('abc')).toBe(false);
      expect(validatePhone('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validatePhone(null as any)).toBe(false);
      expect(validatePhone(undefined as any)).toBe(false);
      expect(validatePhone(123 as any)).toBe(false);
    });

    it('should trim whitespace', () => {
      expect(validatePhone('  +61412345678  ')).toBe(true);
    });
  });

  describe('validateIANATimezone', () => {
    it('should validate correct IANA timezones', () => {
      expect(validateIANATimezone('Australia/Sydney')).toBe(true);
      expect(validateIANATimezone('America/New_York')).toBe(true);
      expect(validateIANATimezone('Europe/London')).toBe(true);
      expect(validateIANATimezone('Asia/Tokyo')).toBe(true);
      expect(validateIANATimezone('UTC')).toBe(true);
    });

    it('should reject invalid timezones', () => {
      expect(validateIANATimezone('EST')).toBe(false); // Abbreviation
      expect(validateIANATimezone('GMT+10')).toBe(false); // Offset
      expect(validateIANATimezone('Invalid/Timezone')).toBe(false);
      expect(validateIANATimezone('Australia')).toBe(false); // No slash
      expect(validateIANATimezone('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateIANATimezone(null as any)).toBe(false);
      expect(validateIANATimezone(undefined as any)).toBe(false);
      expect(validateIANATimezone(123 as any)).toBe(false);
    });
  });

  describe('validateCurrency', () => {
    it('should validate supported currency codes', () => {
      expect(validateCurrency('AUD')).toBe(true);
      expect(validateCurrency('USD')).toBe(true);
      expect(validateCurrency('EUR')).toBe(true);
      expect(validateCurrency('GBP')).toBe(true);
      expect(validateCurrency('JPY')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(validateCurrency('aud')).toBe(true);
      expect(validateCurrency('usd')).toBe(true);
      expect(validateCurrency('Eur')).toBe(true);
    });

    it('should reject unsupported currency codes', () => {
      expect(validateCurrency('XXX')).toBe(false);
      expect(validateCurrency('ABC')).toBe(false);
      expect(validateCurrency('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateCurrency(null as any)).toBe(false);
      expect(validateCurrency(undefined as any)).toBe(false);
      expect(validateCurrency(123 as any)).toBe(false);
    });
  });

  describe('validateLength', () => {
    it('should validate strings within length range', () => {
      expect(validateLength('hello', 3, 10)).toBe(true);
      expect(validateLength('abc', 3, 10)).toBe(true);
      expect(validateLength('1234567890', 3, 10)).toBe(true);
    });

    it('should reject strings outside length range', () => {
      expect(validateLength('ab', 3, 10)).toBe(false); // Too short
      expect(validateLength('12345678901', 3, 10)).toBe(false); // Too long
    });

    it('should trim whitespace before checking', () => {
      expect(validateLength('  hello  ', 3, 10)).toBe(true);
      expect(validateLength('  ab  ', 3, 10)).toBe(false); // Trimmed length = 2
    });

    it('should handle edge cases', () => {
      expect(validateLength('', 0, 10)).toBe(false);
      expect(validateLength(null as any, 3, 10)).toBe(false);
      expect(validateLength(undefined as any, 3, 10)).toBe(false);
    });
  });

  describe('validateUID', () => {
    it('should validate correct UID formats', () => {
      expect(validateUID('abc123def456ghi789jkl')).toBe(true);
      expect(validateUID('12345678901234567890')).toBe(true);
      expect(validateUID('user-id-with-dashes--')).toBe(true);
      expect(validateUID('user_id_with_underscores')).toBe(true);
    });

    it('should reject invalid UIDs', () => {
      expect(validateUID('short')).toBe(false); // Too short
      expect(validateUID('has spaces in it here')).toBe(false);
      expect(validateUID('has@special#chars')).toBe(false);
      expect(validateUID('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateUID(null as any)).toBe(false);
      expect(validateUID(undefined as any)).toBe(false);
    });
  });

  describe('validateCountryCode', () => {
    it('should validate correct country codes', () => {
      expect(validateCountryCode('AU')).toBe(true);
      expect(validateCountryCode('US')).toBe(true);
      expect(validateCountryCode('GB')).toBe(true);
      expect(validateCountryCode('JP')).toBe(true);
    });

    it('should normalize to uppercase', () => {
      expect(validateCountryCode('au')).toBe(true);
      expect(validateCountryCode('us')).toBe(true);
      expect(validateCountryCode('Gb')).toBe(true);
    });

    it('should reject invalid country codes', () => {
      expect(validateCountryCode('USA')).toBe(false); // Too long
      expect(validateCountryCode('A')).toBe(false); // Too short
      expect(validateCountryCode('1A')).toBe(false); // Contains number
      expect(validateCountryCode('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateCountryCode(null as any)).toBe(false);
      expect(validateCountryCode(undefined as any)).toBe(false);
    });
  });

  describe('validateURL', () => {
    it('should validate correct HTTP/HTTPS URLs', () => {
      expect(validateURL('https://example.com')).toBe(true);
      expect(validateURL('http://example.com')).toBe(true);
      expect(validateURL('https://sub.example.com')).toBe(true);
      expect(validateURL('http://localhost:3000')).toBe(true);
      expect(validateURL('https://example.com/path?query=value')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateURL('ftp://example.com')).toBe(false); // Wrong protocol
      expect(validateURL('not-a-url')).toBe(false);
      expect(validateURL('example.com')).toBe(false); // Missing protocol
      expect(validateURL('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateURL(null as any)).toBe(false);
      expect(validateURL(undefined as any)).toBe(false);
    });
  });

  describe('validatePositiveNumber', () => {
    it('should validate positive numbers', () => {
      expect(validatePositiveNumber(1)).toBe(true);
      expect(validatePositiveNumber(100)).toBe(true);
      expect(validatePositiveNumber(0.1)).toBe(true);
      expect(validatePositiveNumber(999999)).toBe(true);
    });

    it('should reject non-positive numbers', () => {
      expect(validatePositiveNumber(0)).toBe(false);
      expect(validatePositiveNumber(-1)).toBe(false);
      expect(validatePositiveNumber(-0.1)).toBe(false);
    });

    it('should reject special values', () => {
      expect(validatePositiveNumber(NaN)).toBe(false);
      expect(validatePositiveNumber(Infinity)).toBe(false);
      expect(validatePositiveNumber(-Infinity)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validatePositiveNumber('5' as any)).toBe(false);
      expect(validatePositiveNumber(null as any)).toBe(false);
      expect(validatePositiveNumber(undefined as any)).toBe(false);
    });
  });

  describe('validateNonNegativeNumber', () => {
    it('should validate non-negative numbers', () => {
      expect(validateNonNegativeNumber(0)).toBe(true);
      expect(validateNonNegativeNumber(1)).toBe(true);
      expect(validateNonNegativeNumber(100)).toBe(true);
      expect(validateNonNegativeNumber(0.1)).toBe(true);
    });

    it('should reject negative numbers', () => {
      expect(validateNonNegativeNumber(-1)).toBe(false);
      expect(validateNonNegativeNumber(-0.1)).toBe(false);
    });

    it('should reject special values', () => {
      expect(validateNonNegativeNumber(NaN)).toBe(false);
      expect(validateNonNegativeNumber(Infinity)).toBe(false);
      expect(validateNonNegativeNumber(-Infinity)).toBe(false);
    });
  });

  describe('validateFutureDate', () => {
    const now = Date.now();

    it('should validate future dates', () => {
      const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
      const nextWeek = new Date(now + 7 * 24 * 60 * 60 * 1000);

      expect(validateFutureDate(tomorrow)).toBe(true);
      expect(validateFutureDate(nextWeek)).toBe(true);
    });

    it('should reject past dates', () => {
      const yesterday = new Date(now - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);

      expect(validateFutureDate(yesterday)).toBe(false);
      expect(validateFutureDate(lastWeek)).toBe(false);
    });

    it('should reject invalid dates', () => {
      const invalidDate = new Date('invalid');

      expect(validateFutureDate(invalidDate)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateFutureDate(null as any)).toBe(false);
      expect(validateFutureDate(undefined as any)).toBe(false);
      expect(validateFutureDate('2024-01-01' as any)).toBe(false);
    });
  });

  describe('validateEnum', () => {
    const roles = ['admin', 'user', 'guest'] as const;

    it('should validate values in enum', () => {
      expect(validateEnum('admin', roles)).toBe(true);
      expect(validateEnum('user', roles)).toBe(true);
      expect(validateEnum('guest', roles)).toBe(true);
    });

    it('should reject values not in enum', () => {
      expect(validateEnum('moderator', roles)).toBe(false);
      expect(validateEnum('superadmin', roles)).toBe(false);
      expect(validateEnum('', roles)).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(validateEnum('Admin', roles)).toBe(false);
      expect(validateEnum('USER', roles)).toBe(false);
    });
  });

  describe('Regex Exports', () => {
    it('should export EMAIL_REGEX', () => {
      expect(EMAIL_REGEX.test('user@example.com')).toBe(true);
      expect(EMAIL_REGEX.test('invalid')).toBe(false);
    });

    it('should export PHONE_REGEX', () => {
      expect(PHONE_REGEX.test('+61412345678')).toBe(true);
      expect(PHONE_REGEX.test('invalid')).toBe(false);
    });

    it('should export UID_REGEX', () => {
      expect(UID_REGEX.test('abc123def456ghi789jkl')).toBe(true);
      expect(UID_REGEX.test('short')).toBe(false);
    });

    it('should export COUNTRY_CODE_REGEX', () => {
      expect(COUNTRY_CODE_REGEX.test('AU')).toBe(true);
      expect(COUNTRY_CODE_REGEX.test('USA')).toBe(false);
    });
  });
});
