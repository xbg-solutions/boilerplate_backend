# Validation Utilities

> Reusable validation functions for common data types

## Overview

The Validation Utilities provide a comprehensive set of validation functions for common data types used across the application. All validators return boolean values (`true` = valid, `false` = invalid) for simple integration into validation logic.

## Features

- **Email validation** with RFC 5322 simplified regex
- **Phone number validation** for E.164 format
- **IANA timezone validation** using Intl API
- **Currency code validation** (ISO 4217)
- **String length validation** with min/max
- **UID format validation** for Firestore IDs
- **Country code validation** (ISO 3166-1 alpha-2)
- **URL validation** for HTTP/HTTPS
- **Number validation** (positive, non-negative)
- **Date validation** (future dates)
- **Enum validation** with type safety

## Installation

```typescript
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
} from '../utilities/validation';
```

## API Reference

### Email Validation

```typescript
validateEmail(email: string): boolean
```

Validates email addresses using simplified RFC 5322 regex.

**Format:** `user@domain.tld`

```typescript
validateEmail('user@example.com')     // true
validateEmail('invalid.email')        // false
validateEmail('user@domain')          // false
validateEmail('')                     // false
```

**Regex:** `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

### Phone Number Validation

```typescript
validatePhone(phone: string): boolean
```

Validates phone numbers in E.164 format.

**Format:** `+[country code][number]` (7-15 digits total)

```typescript
validatePhone('+61412345678')         // true
validatePhone('+14155552671')         // true
validatePhone('0412345678')           // false (no country code)
validatePhone('+1234')                // false (too short)
```

**Regex:** `/^\+?[1-9]\d{6,14}$/`

### IANA Timezone Validation

```typescript
validateIANATimezone(timezone: string): boolean
```

Validates IANA timezone identifiers.

**Format:** `Continent/City` or `UTC`

```typescript
validateIANATimezone('Australia/Sydney')  // true
validateIANATimezone('America/New_York')  // true
validateIANATimezone('UTC')               // true
validateIANATimezone('EST')               // false (abbreviation)
validateIANATimezone('GMT+10')            // false (offset)
```

### Currency Code Validation

```typescript
validateCurrency(code: string): boolean
```

Validates ISO 4217 currency codes (common currencies only for MVP).

**Supported currencies:**
- AUD (Australian Dollar)
- USD (US Dollar)
- EUR (Euro)
- GBP (British Pound)
- JPY (Japanese Yen)
- CNY (Chinese Yuan)
- INR (Indian Rupee)
- CAD (Canadian Dollar)
- NZD (New Zealand Dollar)
- SGD (Singapore Dollar)

```typescript
validateCurrency('AUD')               // true
validateCurrency('usd')               // true (case insensitive)
validateCurrency('XXX')               // false (not supported)
```

### String Length Validation

```typescript
validateLength(str: string, min: number, max: number): boolean
```

Validates string length is within specified range.

```typescript
validateLength('hello', 3, 10)        // true
validateLength('hi', 3, 10)           // false (too short)
validateLength('hello world!', 3, 10) // false (too long)
```

### UID Format Validation

```typescript
validateUID(uid: string): boolean
```

Validates Firestore auto-generated ID format.

**Format:** 20+ alphanumeric characters, hyphens, underscores

```typescript
validateUID('abc123def456ghi789jkl')  // true
validateUID('short-id')               // false (too short)
```

**Regex:** `/^[a-zA-Z0-9_-]{20,}$/`

### Country Code Validation

```typescript
validateCountryCode(code: string): boolean
```

Validates ISO 3166-1 alpha-2 country codes.

**Format:** Two uppercase letters

```typescript
validateCountryCode('AU')             // true
validateCountryCode('us')             // true (normalized to uppercase)
validateCountryCode('USA')            // false (alpha-3)
validateCountryCode('1')              // false
```

**Regex:** `/^[A-Z]{2}$/`

### URL Validation

```typescript
validateURL(url: string): boolean
```

Validates HTTP/HTTPS URLs using native URL parser.

```typescript
validateURL('https://example.com')    // true
validateURL('http://localhost:3000')  // true
validateURL('ftp://files.com')        // false (only HTTP/HTTPS)
validateURL('not-a-url')              // false
```

### Positive Number Validation

```typescript
validatePositiveNumber(value: unknown): boolean
```

Validates value is a positive number (> 0).

```typescript
validatePositiveNumber(5)             // true
validatePositiveNumber(0.1)           // true
validatePositiveNumber(0)             // false
validatePositiveNumber(-5)            // false
validatePositiveNumber(NaN)           // false
validatePositiveNumber(Infinity)      // false
```

### Non-Negative Number Validation

```typescript
validateNonNegativeNumber(value: unknown): boolean
```

Validates value is a non-negative number (>= 0).

```typescript
validateNonNegativeNumber(5)          // true
validateNonNegativeNumber(0)          // true
validateNonNegativeNumber(-5)         // false
validateNonNegativeNumber(NaN)        // false
```

### Future Date Validation

```typescript
validateFutureDate(date: Date): boolean
```

Validates date is in the future.

```typescript
const tomorrow = new Date(Date.now() + 86400000);
const yesterday = new Date(Date.now() - 86400000);

validateFutureDate(tomorrow)          // true
validateFutureDate(yesterday)         // false
validateFutureDate(new Date('invalid')) // false
```

### Enum Validation

```typescript
validateEnum<T extends string>(value: string, allowedValues: readonly T[]): value is T
```

Type-safe enum validation with TypeScript type guard.

```typescript
const ROLES = ['admin', 'member', 'guest'] as const;
type Role = typeof ROLES[number];

const role: string = 'admin';
if (validateEnum(role, ROLES)) {
  // TypeScript knows role is Role type here
  console.log(role); // Type: 'admin' | 'member' | 'guest'
}
```

## Usage Examples

### In Service Layer

```typescript
class UserService {
  async createUser(data: CreateUserDto): Promise<User> {
    // Validate email
    if (!validateEmail(data.email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate phone if provided
    if (data.phone && !validatePhone(data.phone)) {
      throw new ValidationError('Invalid phone format (use E.164: +61412345678)');
    }

    // Validate timezone
    if (!validateIANATimezone(data.timezone)) {
      throw new ValidationError('Invalid timezone (use IANA format: Australia/Sydney)');
    }

    // Validate name length
    if (!validateLength(data.name, 2, 100)) {
      throw new ValidationError('Name must be 2-100 characters');
    }

    return await this.repository.create(data);
  }
}
```

### With Validation Middleware

```typescript
import { body, validationResult } from 'express-validator';

router.post('/users',
  body('email').custom(validateEmail).withMessage('Invalid email'),
  body('phone').optional().custom(validatePhone).withMessage('Invalid phone'),
  body('timezone').custom(validateIANATimezone).withMessage('Invalid timezone'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
  userController.create
);
```

### In Data Models

```typescript
export const UserModel: DataModelSpecification = {
  entities: {
    User: {
      fields: {
        email: {
          type: 'email',
          required: true,
          validate: validateEmail,
        },
        role: {
          type: 'enum',
          values: ['admin', 'member', 'guest'],
          validate: (value) => validateEnum(value, ['admin', 'member', 'guest']),
        },
      },
    },
  },
};
```

## Regex Exports

For custom validation logic, regex patterns are also exported:

```typescript
import { EMAIL_REGEX, PHONE_REGEX, UID_REGEX, COUNTRY_CODE_REGEX } from '../utilities/validation';

// Custom usage
if (EMAIL_REGEX.test(email)) {
  // Email is valid format
}
```

## Known Gaps & Future Enhancements

### Missing Validators
- [ ] **Credit card number** validation (Luhn algorithm)
- [ ] **IP address** validation (IPv4/IPv6)
- [ ] **MAC address** validation
- [ ] **UUID** validation (v1, v4, v5)
- [ ] **Slug** validation (URL-safe strings)
- [ ] **Color code** validation (hex, rgb, rgba)
- [ ] **Port number** validation (1-65535)
- [ ] **Domain name** validation
- [ ] **File extension** validation
- [ ] **MIME type** validation
- [ ] **Semantic version** validation
- [ ] **JSON** validation
- [ ] **XML** validation
- [ ] **Base64** validation
- [ ] **JWT token** format validation
- [ ] **Password strength** validation
- [ ] **Username** validation (alphanumeric, special chars)

### Enhanced Validation
- [ ] **Email**: MX record lookup for real email validation
- [ ] **Phone**: Country-specific format validation
- [ ] **Currency**: Support all ISO 4217 currencies
- [ ] **Country**: Validate against full ISO 3166-1 list
- [ ] **Timezone**: Validate with timezone database lookup
- [ ] **URL**: Support custom protocols (ftp, ssh, etc.)
- [ ] **Date**: Date range validation
- [ ] **Number**: Range validation with custom min/max

### Error Messages
- [ ] Return detailed error messages instead of boolean
- [ ] Internationalization support
- [ ] Custom error message configuration
- [ ] Validation context in errors

### Advanced Features
- [ ] **Async validators** for database lookups
- [ ] **Composite validators** (combine multiple validators)
- [ ] **Conditional validation** based on other fields
- [ ] **Schema validation** for complex objects
- [ ] **Sanitization** functions alongside validation
- [ ] **Custom validator** registration
- [ ] **Validator chaining** for complex rules
- [ ] **Performance optimization** with caching

### Testing Gaps
- [ ] Unit tests for all validators
- [ ] Edge case testing (Unicode, special characters)
- [ ] Performance benchmarks
- [ ] Fuzz testing for regex validators

### Documentation Gaps
- [ ] Common validation patterns guide
- [ ] Integration with popular validation libraries
- [ ] Migration guide from other validation tools
- [ ] Performance considerations

## Best Practices

1. **Use specific validators**: Don't write custom regex when a validator exists
2. **Combine validators**: Chain multiple validators for complex rules
3. **Validate early**: Validate at API boundary before processing
4. **Provide clear messages**: Tell users exactly what format is expected
5. **Normalize input**: Trim whitespace, uppercase country codes, etc.
6. **Consider UX**: Balance security with user-friendliness

## Common Patterns

### Optional Field Validation

```typescript
// Validate only if field is provided
if (data.phone && !validatePhone(data.phone)) {
  throw new ValidationError('Invalid phone format');
}
```

### Multiple Field Validation

```typescript
const errors: string[] = [];

if (!validateEmail(data.email)) {
  errors.push('Invalid email');
}

if (!validatePhone(data.phone)) {
  errors.push('Invalid phone');
}

if (errors.length > 0) {
  throw new ValidationError('Validation failed', { errors });
}
```

### Normalized Validation

```typescript
// Normalize before validation
const countryCode = data.country.toUpperCase();
if (!validateCountryCode(countryCode)) {
  throw new ValidationError('Invalid country code');
}

const email = data.email.trim().toLowerCase();
if (!validateEmail(email)) {
  throw new ValidationError('Invalid email');
}
```

## Related Components

- **errors**: ValidationError for throwing validation failures
- **validation.middleware.ts**: Express middleware for request validation
- **address-validation**: Advanced address validation

## Support

For issues or questions:
- Check validator documentation for expected format
- Review regex patterns for custom needs
- Consider using validation middleware for consistent handling
- Verify input normalization before validation

## References

- [RFC 5322 Email Format](https://tools.ietf.org/html/rfc5322)
- [E.164 Phone Format](https://en.wikipedia.org/wiki/E.164)
- [IANA Timezone Database](https://www.iana.org/time-zones)
- [ISO 4217 Currency Codes](https://en.wikipedia.org/wiki/ISO_4217)
- [ISO 3166-1 Country Codes](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
