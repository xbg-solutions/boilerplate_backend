/**
 * Validation Utilities
 * 
 * Reusable validation functions for common data types.
 * All validators return boolean (true = valid, false = invalid).
 */

/**
 * Email validation (RFC 5322 simplified)
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Phone number validation (E.164 format)
 * Format: +[country code][number] (e.g., +61412345678)
 * Length: 7-15 digits total (minimum viable phone number)
 */
export const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export function validatePhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  return PHONE_REGEX.test(phone.trim());
}

/**
 * IANA timezone validation
 * Validates against the IANA timezone database
 * Requires proper format (e.g., "Australia/Sydney", not "EST")
 */
export function validateIANATimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') {
    return false;
  }

  // Require proper IANA format (must contain slash: Continent/City)
  // Reject abbreviations like EST, GMT, UTC offsets like GMT+10
  if (!timezone.includes('/') && timezone !== 'UTC') {
    return false;
  }

  try {
    // Use Intl.DateTimeFormat to validate timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Currency code validation (ISO 4217)
 * Common currencies only for MVP
 */
const VALID_CURRENCIES = new Set([
  'AUD', // Australian Dollar
  'USD', // US Dollar
  'EUR', // Euro
  'GBP', // British Pound
  'JPY', // Japanese Yen
  'CNY', // Chinese Yuan
  'INR', // Indian Rupee
  'CAD', // Canadian Dollar
  'NZD', // New Zealand Dollar
  'SGD', // Singapore Dollar
]);

export function validateCurrency(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }
  return VALID_CURRENCIES.has(code.toUpperCase());
}

/**
 * String length validation
 */
export function validateLength(
  str: string,
  min: number,
  max: number
): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  const length = str.trim().length;
  return length >= min && length <= max;
}

/**
 * UID format validation (Firestore auto-generated IDs)
 * Format: 20+ alphanumeric characters, hyphens, underscores
 */
export const UID_REGEX = /^[a-zA-Z0-9_-]{20,}$/;

export function validateUID(uid: string): boolean {
  if (!uid || typeof uid !== 'string') {
    return false;
  }
  return UID_REGEX.test(uid);
}

/**
 * ISO 3166-1 alpha-2 country code validation
 * Format: Two uppercase letters (e.g., AU, US, GB)
 */
export const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

export function validateCountryCode(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }
  return COUNTRY_CODE_REGEX.test(code.toUpperCase());
}

/**
 * URL validation (basic)
 */
export function validateURL(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Positive number validation
 */
export function validatePositiveNumber(value: unknown): boolean {
  if (typeof value !== 'number') {
    return false;
  }
  return value > 0 && !isNaN(value) && isFinite(value);
}

/**
 * Non-negative number validation (>= 0)
 */
export function validateNonNegativeNumber(value: unknown): boolean {
  if (typeof value !== 'number') {
    return false;
  }
  return value >= 0 && !isNaN(value) && isFinite(value);
}

/**
 * Date validation (not in the past)
 */
export function validateFutureDate(date: Date): boolean {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return false;
  }
  return date.getTime() > Date.now();
}

/**
 * Enum validation helper
 */
export function validateEnum<T extends string>(
  value: string,
  allowedValues: readonly T[]
): value is T {
  return allowedValues.includes(value as T);
}