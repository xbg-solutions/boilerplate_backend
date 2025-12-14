# Address Validation Utility

> Validate physical addresses using geocoding services

## Overview

The Address Validation utility provides a simple "is this a real address" validation using geocoding APIs. It verifies that addresses exist, are properly formatted, and meet quality standards before storing them in your system.

## Features

- **Geocoding validation** using Google Maps Geocoding API
- **Quality checking** to reject overly generic addresses
- **Country verification** to ensure address matches expected country
- **Graceful degradation** when API is not configured or errors occur
- **Structured logging** with PII-safe address information
- **Formatted address** returned from geocoding service
- **Coordinates** (latitude/longitude) for valid addresses

## Installation

```typescript
import {
  addressValidator,
  AddressComponents,
  AddressValidationResult,
} from '../utilities/address-validation';
```

## Usage

### Basic Validation

```typescript
import { addressValidator } from '../utilities/address-validation';
import { logger } from '../utilities/logger';

const address: AddressComponents = {
  addressLine1: '1600 Amphitheatre Parkway',
  city: 'Mountain View',
  state: 'CA',
  postalCode: '94043',
  country: 'US',
};

const result = await addressValidator.validateAddress(address, logger);

if (result.isValid) {
  console.log('Valid address:', result.formattedAddress);
  console.log('Coordinates:', result.location);
} else {
  console.log('Invalid address:', result.reason);
}
```

### Validate or Throw

Use in service layer to throw an error if address is invalid:

```typescript
try {
  await addressValidator.validateAddressOrThrow(address, logger);
  // Proceed with saving address
} catch (error) {
  // Handle validation error
  console.error(error.message);
}
```

## Configuration

Configure Google Maps API in `functions/src/config/maps.config.ts`:

```typescript
export const MAPS_CONFIG = {
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  },
};

export function isGoogleMapsConfigured(): boolean {
  return !!MAPS_CONFIG.googleMaps.apiKey;
}

export function getGoogleMapsApiKey(): string {
  if (!isGoogleMapsConfigured()) {
    throw new Error('Google Maps API key not configured');
  }
  return MAPS_CONFIG.googleMaps.apiKey;
}
```

Set environment variable:

```bash
GOOGLE_MAPS_API_KEY=your_api_key_here
```

## API Reference

### AddressComponents

```typescript
interface AddressComponents {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city: string;                    // Required
  state?: string | null;
  postalCode?: string | null;
  country: string;                  // Required (ISO 3166-1 alpha-2)
}
```

### AddressValidationResult

```typescript
interface AddressValidationResult {
  isValid: boolean;
  reason?: string;                  // Present when isValid is false
  formattedAddress?: string;        // Google's formatted address
  location?: {
    lat: number;
    lng: number;
  };
}
```

### Methods

#### `validateAddress(address, logger)`

Validates an address using Google Maps Geocoding API.

**Parameters:**
- `address: AddressComponents` - Address components to validate
- `logger: Logger` - Logger instance for structured logging

**Returns:** `Promise<AddressValidationResult>`

**Behavior:**
- Returns `isValid: true` if API is not configured (graceful degradation)
- Returns `isValid: true` if API error occurs (doesn't block address creation)
- Returns `isValid: false` if address not found or too generic
- 5-second timeout for API calls

#### `validateAddressOrThrow(address, logger)`

Convenience method that throws `ValidationError` if address is invalid.

**Parameters:**
- `address: AddressComponents` - Address components to validate
- `logger: Logger` - Logger instance

**Returns:** `Promise<void>`

**Throws:** `ValidationError` if address is invalid

## Validation Logic

### Quality Checks

The validator performs several quality checks:

1. **Geocoding success**: Address must be found by geocoding service
2. **Specificity**: Rejects overly generic results (country-level or state-level only)
3. **City presence**: Requires at least city-level specificity
4. **Country match**: Verifies geocoded country matches requested country

### Error Handling

The validator is designed to be permissive with errors:

- **API not configured**: Returns `isValid: true` (validation skipped)
- **API errors/timeout**: Returns `isValid: true` (doesn't block operations)
- **Address not found**: Returns `isValid: false` (rejects address)
- **Quality check fails**: Returns `isValid: false` (rejects address)

This ensures that API configuration issues or temporary outages don't prevent legitimate operations.

## Example Scenarios

### Valid Address

```typescript
const address = {
  addressLine1: '1600 Amphitheatre Parkway',
  city: 'Mountain View',
  state: 'CA',
  postalCode: '94043',
  country: 'US',
};

// Result:
// {
//   isValid: true,
//   formattedAddress: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
//   location: { lat: 37.4224764, lng: -122.0842499 }
// }
```

### Invalid Address (Not Found)

```typescript
const address = {
  addressLine1: '123 Fake Street',
  city: 'Nonexistent City',
  country: 'US',
};

// Result:
// {
//   isValid: false,
//   reason: 'Address not found'
// }
```

### Invalid Address (Too Generic)

```typescript
const address = {
  city: 'California',
  country: 'US',
};

// Result:
// {
//   isValid: false,
//   reason: 'Address is too generic - please provide a more specific address'
// }
```

### Country Mismatch

```typescript
const address = {
  addressLine1: '10 Downing Street',
  city: 'London',
  country: 'US',  // Wrong country code
};

// Result:
// {
//   isValid: false,
//   reason: 'Address country mismatch - expected US, found GB'
// }
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **Here Maps** provider as alternative to Google Maps
- [ ] **Mapbox** geocoding provider
- [ ] **OpenStreetMap Nominatim** for open-source option
- [ ] Provider abstraction layer for easy switching

### Missing Features
- [ ] **Batch validation** for multiple addresses
- [ ] **Address autocomplete** suggestions
- [ ] **Address normalization** (standardize format)
- [ ] **PO Box detection** and handling
- [ ] **Apartment/unit number** validation
- [ ] **Distance calculation** between addresses
- [ ] **Address similarity** comparison
- [ ] **International address** format validation
- [ ] **Caching** of validation results to reduce API calls
- [ ] **Rate limiting** to prevent API quota exhaustion

### Testing Gaps
- [ ] Unit tests for validation logic
- [ ] Integration tests with Google Maps API
- [ ] Mock provider for testing
- [ ] Test cases for edge cases (special characters, Unicode, etc.)

### Configuration Gaps
- [ ] Multiple provider support in configuration
- [ ] Provider failover strategy
- [ ] Configurable timeout values
- [ ] Configurable quality thresholds

### Monitoring Gaps
- [ ] API usage metrics
- [ ] Validation success/failure rates
- [ ] Performance monitoring
- [ ] Cost tracking for API usage

## Best Practices

1. **Always use with logger**: Provides debugging information for validation failures
2. **Handle validation errors gracefully**: Don't block user flows on validation failures
3. **Use ISO country codes**: Always use 2-letter ISO 3166-1 alpha-2 codes
4. **Consider caching**: Cache validation results to reduce API calls
5. **Monitor API usage**: Track costs and implement rate limiting if needed

## Dependencies

- `@googlemaps/google-maps-services-js`: Google Maps API client
- `../errors`: Error types (ValidationError)
- `../logger`: Structured logging
- `../../config/maps.config`: Maps configuration

## Related Utilities

- **validation**: General validation utilities
- **errors**: Custom error types
- **logger**: Structured logging

## Support

For issues or questions:
- Check logs for validation failure reasons
- Verify Google Maps API key is configured
- Ensure sufficient API quota
- Review address format requirements

## References

- [Google Maps Geocoding API](https://developers.google.com/maps/documentation/geocoding)
- [ISO 3166-1 Country Codes](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
