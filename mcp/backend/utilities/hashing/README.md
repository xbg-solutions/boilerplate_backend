# PII Encryption Utility

A defensive security utility for protecting Personally Identifiable Information (PII) in the Wishlist Coordination Platform. This utility implements reversible encryption with lazy decryption patterns for GDPR compliance.

## Overview

This utility provides secure encryption and lazy decryption of PII fields to protect sensitive user data at rest. It follows the principle of **data minimization** and **explicit consent** - PII is only decrypted when explicitly requested by services.

## Architecture

The encryption utility follows the **lazy decryption pattern** described in the [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#73-pii-hashing-detailed-implementation):

- **AES-256-GCM encryption** - Authenticated encryption with reversible decryption
- **No automatic middleware** - Services must explicitly request decryption
- **Selective field decryption** - Only specific fields are decrypted per request
- **Secure key management** - 256-bit encryption key stored in environment variables

## Protected Fields

The following PII fields are automatically hashed at rest:

### User Fields (identityDB)
- `user.email`
- `user.phoneNumber`

### Contact Fields (relationshipsDB)
- `contact.email`
- `contact.phoneNumber`

### Address Fields (relationshipsDB)
- `address.addressLine1`
- `address.addressLine2`
- `address.city`
- `address.state`
- `address.postalCode`
- `address.country`

## Setup

### Generate Encryption Key

```bash
# Generate a 256-bit encryption key (64 hex characters)
openssl rand -hex 32
```

### Environment Configuration

Add the key to your environment variables:

```bash
# .env or Firebase Functions config
PII_ENCRYPTION_KEY=your_64_character_hex_key_here
```

## Usage

### Encrypting Fields Before Storage

```typescript
import { hashFields } from './utilities/hashing';

// Encrypt user data before saving
const userData = {
  name: 'John Doe',
  email: 'john@example.com',
  phoneNumber: '+61412345678'
};

const encryptedUser = hashFields(userData, 'user');
// Result: {
//   name: 'John Doe',
//   email: 'iv:encrypted:authTag',
//   phoneNumber: 'iv:encrypted:authTag'
// }

await userRepository.createUser(encryptedUser);
```

### Lazy Decryption in Services

```typescript
import { unhashFields } from './utilities/hashing';

// Service explicitly requests specific fields to decrypt
async getContactById(
  contactUID: string,
  includeEmail: boolean = false
): Promise<Contact> {
  const contact = await contactRepository.getContactById(contactUID);

  if (includeEmail && contact.email) {
    // Explicitly decrypt only when needed and requested
    return unhashFields(contact, ['contact.email']);
  }

  return contact; // Returns with encrypted fields
}
```

### Check if Field Should Be Encrypted

```typescript
import { isHashedField } from './utilities/hashing';

const shouldEncrypt = isHashedField('contact.email'); // true
const shouldNotEncrypt = isHashedField('user.name');   // false
```

## File Structure

```
hashing/
├── index.ts                   # Barrel exports
├── hashed-fields-lookup.ts    # Registry of fields requiring encryption
├── hasher.ts                  # Encryption functions (AES-256-GCM)
├── unhashing.ts               # Decryption functions (AES-256-GCM)
└── README.md                  # This documentation
```

## Encryption Format

Encrypted values are stored in the format:
```
{iv}:{encrypted}:{authTag}
```

Where:
- `iv` - Initialization Vector (12 bytes / 96 bits, base64 encoded)
- `encrypted` - Encrypted ciphertext (base64 encoded)
- `authTag` - Authentication Tag (16 bytes / 128 bits, base64 encoded)

Example:
```
abc123def456:xyz789uvw012:ghi345jkl678
```

## Security Considerations

- Uses **AES-256-GCM** for authenticated encryption with reversible decryption
- **256-bit key** (32 bytes) stored securely in environment variables
- **Random IV** generated for each encryption (no IV reuse)
- **Authentication tag** prevents tampering and ensures data integrity
- Implements **lazy decryption pattern** for controlled data access

## Compliance

This utility supports compliance with:

- **GDPR** (EU) - Data minimization and protection
- **SOC 2** (US) - Access control and audit logging
- **Essential Eight** (AU) - User application hardening

## Best Practices

### ✅ DO
- Encrypt PII fields before any database write operations
- Use lazy decryption - only when explicitly needed
- Log access to decrypted PII for audit trails (but never log the PII itself)
- Use entity-specific field paths (`contact.email`, not just `email`)
- Store encryption key securely (environment variables, not in code)
- Rotate encryption keys periodically (future enhancement)

### ❌ DON'T
- Never log PII in plaintext (use UIDs or masked data)
- Never automatically decrypt on every GET request
- Never store payment data (use gateway references only)
- Never commit encryption keys to version control
- Never share encryption keys across environments (dev/staging/prod)

## Error Handling

The utility gracefully handles edge cases:

- **Null/empty values** - Skipped (not encrypted)
- **Non-string values** - Skipped (not encrypted)
- **Unknown field paths** - Ignored during decryption
- **Non-encrypted values** - Passed through unchanged
- **Invalid format** - Throws error with detailed message
- **Decryption failure** - Throws error (data corruption or wrong key)

## Testing

Unit tests verify:
- Correct field identification from registry
- Proper encryption of string values only
- Lazy decryption behavior
- Encryption/decryption roundtrip accuracy
- Edge case handling (null, empty, non-string values)

### Test Encryption/Decryption

```typescript
import { hashValue, unhashValue } from './utilities/hashing';

// Test roundtrip
const plaintext = 'test@example.com';
const encrypted = hashValue(plaintext);
const decrypted = unhashValue(encrypted);

console.log(plaintext === decrypted); // true
```

## Future Roadmap

1. **Phase 1 (COMPLETE)** - AES-256-GCM encryption with reversible decryption ✅
2. **Phase 2 (Next)** - Key rotation mechanism for periodic key updates
3. **Phase 3 (Enhancement)** - Hardware security modules (HSM) integration
4. **Phase 4 (Scale)** - Field-level encryption keys for enhanced security
5. **Phase 5 (Compliance)** - GDPR data export with automatic decryption

## Related Documentation

- [Architecture Governance Document](../../../__docs__/20251005_arch_governance_doc.md#7-privacy--compliance)
- [PII Hashing Implementation](../../../__docs__/20251005_arch_governance_doc.md#73-pii-hashing-detailed-implementation)
- [Security & Data Protection](../../../__docs__/20251005_arch_governance_doc.md#8-security--data-protection)