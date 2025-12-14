# Timezone Calculator Utility

> Calculate IANA timezones from city and country information

## Overview

The Timezone Calculator provides offline timezone calculation from city and country information. It uses a country-based lookup strategy that's fast, reliable, and works offline - perfect for MVP scenarios. For Australian cities, it provides precise city-level timezone resolution.

## Features

- **Country-based timezone lookup** using offline database
- **City-level precision** for Australian cities
- **Confidence scoring** (high, medium, low)
- **Graceful fallbacks** for unknown countries/cities
- **Multiple timezone detection** for countries with multiple zones
- **IANA timezone validation**
- **Structured logging** support
- **Zero external API calls** (offline operation)

## Installation

```typescript
import {
  calculateTimezone,
  calculateTimezoneWithLogger,
  isValidTimezone,
  getCountryTimezones,
  getCountryInfo,
} from '../utilities/timezone';
```

## Usage

### Basic Timezone Calculation

```typescript
const result = calculateTimezone('Sydney', 'AU');

console.log(result.timezone);          // 'Australia/Sydney'
console.log(result.confidence);        // 'high'
console.log(result.multipleTimezones); // true
console.log(result.usedFallback);      // false
```

### With Logger Integration

```typescript
import { logger } from '../logger';

const result = calculateTimezoneWithLogger('Melbourne', 'AU', logger);
// Automatically logs debug/info/warn messages
```

### With Options

```typescript
const result = calculateTimezone('Unknown City', 'XX', {
  fallbackTimezone: 'America/New_York',
  verbose: true,
});

console.log(result.timezone);      // 'America/New_York'
console.log(result.usedFallback);  // true
console.log(result.confidence);    // 'low'
```

### Validate Timezone

```typescript
isValidTimezone('Australia/Sydney');    // true
isValidTimezone('America/New_York');    // true
isValidTimezone('Invalid/Timezone');    // false
isValidTimezone('EST');                 // false (use IANA format)
```

### Get Country Timezones

```typescript
const timezones = getCountryTimezones('AU');
// ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', ...]

const usTimezones = getCountryTimezones('US');
// ['America/New_York', 'America/Chicago', 'America/Denver', ...]
```

### Get Country Information

```typescript
const aus = getCountryInfo('AU');
console.log(aus.name);       // 'Australia'
console.log(aus.timezones);  // Array of all Australian timezones
console.log(aus.id);         // 'AU'
```

## API Reference

### calculateTimezone(city, countryCode, options?)

Calculates IANA timezone from city and country.

**Parameters:**
- `city: string` - City name (used for Australian city matching)
- `countryCode: string` - ISO 3166-1 alpha-2 country code (e.g., 'AU', 'US')
- `options?: TimezoneCalculationOptions`
  - `fallbackTimezone?: string` - Fallback if calculation fails (default: 'UTC')
  - `verbose?: boolean` - Enable console logging (default: false)

**Returns:** `TimezoneCalculationResult`

```typescript
interface TimezoneCalculationResult {
  timezone: string;              // IANA timezone
  usedFallback: boolean;         // Whether fallback was used
  multipleTimezones: boolean;    // Whether country has multiple zones
  availableTimezones?: string[]; // All timezones for country (if multiple)
  confidence: 'high' | 'medium' | 'low';
}
```

### calculateTimezoneWithLogger(city, countryCode, logger?)

Same as `calculateTimezone` but with structured logging support.

**Parameters:**
- `city: string`
- `countryCode: string`
- `logger?: { debug?, warn?, info? }` - Logger instance

**Returns:** `TimezoneCalculationResult`

### isValidTimezone(timezone)

Validates IANA timezone string.

**Parameters:**
- `timezone: string` - Timezone to validate

**Returns:** `boolean`

### getCountryTimezones(countryCode)

Gets all timezones for a country.

**Parameters:**
- `countryCode: string` - ISO 3166-1 alpha-2 country code

**Returns:** `string[]` - Array of IANA timezones

### getCountryInfo(countryCode)

Gets full country information including timezones.

**Parameters:**
- `countryCode: string` - ISO 3166-1 alpha-2 country code

**Returns:** Country data object or `null`

## Calculation Logic

### Single Timezone Countries

For countries with a single timezone, returns that timezone with **high confidence**.

```typescript
calculateTimezone('Paris', 'FR');
// { timezone: 'Europe/Paris', confidence: 'high', ... }
```

### Multiple Timezone Countries

#### Australia (City-Level Precision)

For Australia, the utility has city-level mappings for major cities:

```typescript
calculateTimezone('Sydney', 'AU');
// { timezone: 'Australia/Sydney', confidence: 'high' }

calculateTimezone('Melbourne', 'AU');
// { timezone: 'Australia/Melbourne', confidence: 'high' }

calculateTimezone('Brisbane', 'AU');
// { timezone: 'Australia/Brisbane', confidence: 'high' }

// Unknown Australian city - fallback to Sydney
calculateTimezone('Unknown Town', 'AU');
// { timezone: 'Australia/Sydney', confidence: 'medium' }
```

**Supported Australian Cities:**
- **NSW/ACT**: Sydney, Newcastle, Wollongong, Canberra, etc.
- **VIC**: Melbourne, Geelong, Ballarat, Bendigo
- **QLD**: Brisbane, Gold Coast, Cairns, Townsville, etc.
- **WA**: Perth, Fremantle, Bunbury, etc.
- **SA**: Adelaide, Mount Gambier, etc.
- **TAS**: Hobart, Launceston, etc.
- **NT**: Darwin, Alice Springs
- **Special**: Lord Howe Island, Broken Hill, Eucla

#### Other Countries

For non-Australian multi-timezone countries, uses the first timezone (usually most populous) with **medium confidence**.

```typescript
calculateTimezone('New York', 'US');
// { timezone: 'America/New_York', confidence: 'medium', ... }
```

### Unknown Countries

For unknown countries, uses fallback timezone with **low confidence**.

```typescript
calculateTimezone('City', 'XX');
// { timezone: 'UTC', confidence: 'low', usedFallback: true }
```

## Confidence Levels

- **High**: Single timezone country OR matched Australian city
- **Medium**: Multiple timezone country (first zone selected)
- **Low**: Fallback used (unknown country)

## Example Scenarios

### Service Layer Integration

```typescript
class UserService {
  async createUser(data: CreateUserDto): Promise<User> {
    // Calculate timezone from city and country
    const timezoneResult = calculateTimezoneWithLogger(
      data.city,
      data.country,
      this.logger
    );

    // Warn if low confidence
    if (timezoneResult.confidence === 'low') {
      this.logger.warn('Low confidence timezone calculation', {
        city: data.city,
        country: data.country,
        timezone: timezoneResult.timezone,
      });
    }

    // Store timezone with user
    const user = await this.repository.create({
      ...data,
      timezone: timezoneResult.timezone,
    });

    return user;
  }
}
```

### API Endpoint

```typescript
router.post('/users/timezone', async (req, res) => {
  const { city, country } = req.body;

  const result = calculateTimezone(city, country);

  res.json({
    timezone: result.timezone,
    confidence: result.confidence,
    multipleTimezones: result.multipleTimezones,
    availableTimezones: result.availableTimezones,
  });
});
```

### User Timezone Preferences

```typescript
// Let user select from available timezones if multiple
const timezones = getCountryTimezones(user.country);

if (timezones.length > 1) {
  // Show dropdown for user to select specific timezone
  return {
    message: 'Multiple timezones available',
    timezones: timezones,
  };
} else {
  // Auto-assign single timezone
  user.timezone = timezones[0];
}
```

## Known Gaps & Future Enhancements

### City-Level Precision Gaps
- [ ] **US cities** city-to-timezone mapping (New York, Los Angeles, Chicago, etc.)
- [ ] **Canada cities** city-to-timezone mapping
- [ ] **Brazil cities** city-to-timezone mapping
- [ ] **Russia cities** city-to-timezone mapping (11 timezones!)
- [ ] **Other multi-timezone countries** city mappings
- [ ] **Fuzzy city matching** (handle typos, alternate spellings)
- [ ] **City aliases** (NYC -> New York, LA -> Los Angeles)

### External API Integration
- [ ] **Google Places API** for precise lat/lng → timezone
- [ ] **Google Timezone API** for coordinate-based lookup
- [ ] **GeoNames API** for city database
- [ ] **TimeZoneDB API** as alternative
- [ ] **Fallback cascade** (city map → API → country → UTC)
- [ ] **API caching** to reduce costs
- [ ] **Rate limiting** for API calls

### DST Handling
- [ ] **DST transition detection** (when clocks change)
- [ ] **DST-aware time calculations**
- [ ] **Historical DST rules** for past dates
- [ ] **Future DST predictions**
- [ ] **DST exceptions** (Arizona, etc.)

### Advanced Features
- [ ] **Coordinate-based lookup** (latitude/longitude → timezone)
- [ ] **Reverse timezone lookup** (timezone → cities)
- [ ] **Time conversion** between timezones
- [ ] **Current time** in timezone
- [ ] **Timezone abbreviations** (AEST, PST, etc.)
- [ ] **UTC offset calculation** for timezone
- [ ] **Business hours** calculation across timezones
- [ ] **Meeting time** suggestions across zones

### Data Updates
- [ ] **Automatic timezone database** updates
- [ ] **City mapping** version control
- [ ] **Timezone rule** change notifications
- [ ] **Country changes** (new countries, boundary changes)

### Testing Gaps
- [ ] Unit tests for all functions
- [ ] Test cases for all Australian cities
- [ ] Test cases for multi-timezone countries
- [ ] Test cases for DST transitions
- [ ] Edge case testing (special territories, etc.)
- [ ] Integration tests with logger

### Configuration Gaps
- [ ] Configurable city mappings (user-provided)
- [ ] Configurable fallback strategies
- [ ] Configurable confidence thresholds
- [ ] Custom timezone databases

### Monitoring Gaps
- [ ] Confidence score distribution metrics
- [ ] Fallback usage tracking
- [ ] Unknown city/country logging
- [ ] API usage metrics (when integrated)

## Best Practices

1. **Check confidence**: Always check `confidence` level in production
2. **Log low confidence**: Alert on low confidence calculations
3. **Validate input**: Validate country codes before calculation
4. **Allow user override**: Let users manually set timezone
5. **Cache results**: Cache timezone for user to avoid recalculation
6. **Use with logger**: Use `calculateTimezoneWithLogger` for debugging

## Common Patterns

### With Validation

```typescript
import { validateCountryCode } from '../validation';

if (!validateCountryCode(countryCode)) {
  throw new ValidationError('Invalid country code');
}

const result = calculateTimezone(city, countryCode);
```

### With User Override

```typescript
// Calculate default timezone
const calculated = calculateTimezone(user.city, user.country);

// Allow user to override if low confidence
if (calculated.confidence === 'low') {
  // Show timezone selector to user
  user.timezone = userSelectedTimezone;
} else {
  user.timezone = calculated.timezone;
}
```

### With Multi-Timezone Handling

```typescript
const result = calculateTimezone(city, country);

if (result.multipleTimezones && result.availableTimezones) {
  console.log(`Multiple timezones available for ${country}:`);
  result.availableTimezones.forEach(tz => console.log(`  - ${tz}`));
  console.log(`Selected: ${result.timezone} (${result.confidence} confidence)`);
}
```

## Dependencies

- `countries-and-timezones`: Offline country and timezone database
- `Intl.DateTimeFormat`: Native timezone validation (Node.js built-in)

## Related Utilities

- **validation**: `validateIANATimezone()` for timezone validation
- **logger**: Structured logging integration
- **address-validation**: Can be combined for full location validation

## Support

For issues or questions:
- Check country code is valid ISO 3166-1 alpha-2
- Review confidence level for accuracy assessment
- Use verbose mode for debugging
- Consider implementing API-based lookup for high precision needs

## References

- [IANA Time Zone Database](https://www.iana.org/time-zones)
- [ISO 3166-1 Country Codes](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
- [countries-and-timezones Package](https://www.npmjs.com/package/countries-and-timezones)
- [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
