/**
 * Timezone Calculator Utility
 * 
 * Calculates IANA timezone from city and country.
 * Strategy: Country-based lookup (offline, fast, good for MVP)
 * Future: Can integrate Google Places/Timezone API for precision
 * 
 * @module utilities/timezone
 * @reusable - Can be used in any Node.js project
 */

import ct from 'countries-and-timezones';

/**
 * Australian city to timezone mapping (offline, high precision)
 * Covers all major cities and state capitals for launch market
 */
const AUSTRALIAN_CITY_TIMEZONES: Record<string, string> = {
  // New South Wales
  'sydney': 'Australia/Sydney',
  'newcastle': 'Australia/Sydney',
  'wollongong': 'Australia/Sydney',
  'centralcoast': 'Australia/Sydney',
  'bluemountains': 'Australia/Sydney',
  'canberra': 'Australia/Sydney', // ACT uses Sydney timezone

  // Victoria
  'melbourne': 'Australia/Melbourne',
  'geelong': 'Australia/Melbourne',
  'ballarat': 'Australia/Melbourne',
  'bendigo': 'Australia/Melbourne',

  // Queensland
  'brisbane': 'Australia/Brisbane',
  'goldcoast': 'Australia/Brisbane',
  'sunshinecoast': 'Australia/Brisbane',
  'townsville': 'Australia/Brisbane',
  'cairns': 'Australia/Brisbane',
  'toowoomba': 'Australia/Brisbane',
  'rockhampton': 'Australia/Brisbane',
  'mackay': 'Australia/Brisbane',

  // Western Australia
  'perth': 'Australia/Perth',
  'fremantle': 'Australia/Perth',
  'bunbury': 'Australia/Perth',
  'geraldton': 'Australia/Perth',
  'kalgoorlie': 'Australia/Perth',
  'albany': 'Australia/Perth',

  // South Australia
  'adelaide': 'Australia/Adelaide',
  'mountgambier': 'Australia/Adelaide',
  'whyalla': 'Australia/Adelaide',
  'portaugusta': 'Australia/Adelaide',

  // Tasmania
  'hobart': 'Australia/Hobart',
  'launceston': 'Australia/Hobart',
  'burnie': 'Australia/Hobart',
  'devonport': 'Australia/Hobart',

  // Northern Territory
  'darwin': 'Australia/Darwin',
  'alicesprings': 'Australia/Darwin',
  'katherina': 'Australia/Darwin',

  // Lord Howe Island (special case - UTC+10:30/+11)
  'lordhowe': 'Australia/Lord_Howe',
  'lordhoweisland': 'Australia/Lord_Howe',

  // Broken Hill (NSW but uses SA time)
  'brokenhill': 'Australia/Broken_Hill',

  // Eucla (WA border town with unique timezone)
  'eucla': 'Australia/Eucla'
};

/**
 * Normalize city name for lookup
 * Removes spaces, hyphens, apostrophes and converts to lowercase
 */
function normalizeCityName(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/[\s\-']/g, ''); // Remove spaces, hyphens, apostrophes
}

/**
 * Look up timezone for Australian city
 * Returns timezone if found, undefined if not in mapping
 */
function getAustralianCityTimezone(city: string): string | undefined {
  const normalized = normalizeCityName(city);
  return AUSTRALIAN_CITY_TIMEZONES[normalized];
}

/**
 * Timezone calculation options
 */
export interface TimezoneCalculationOptions {
  /** Fallback timezone if calculation fails (default: 'UTC') */
  fallbackTimezone?: string;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Timezone calculation result
 */
export interface TimezoneCalculationResult {
  /** Calculated IANA timezone (e.g., 'Australia/Sydney') */
  timezone: string;
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Whether country has multiple timezones */
  multipleTimezones: boolean;
  /** All available timezones for the country (if multiple) */
  availableTimezones?: string[];
  /** Confidence level: 'high' (single TZ), 'medium' (multi TZ), 'low' (fallback) */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Calculate timezone from city and country
 * 
 * @param city - City name (currently used for logging only; precision TBD in future)
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., 'AU', 'US', 'GB')
 * @param options - Calculation options
 * @returns Timezone calculation result
 * 
 * @example
 * ```typescript
 * const result = calculateTimezone('Sydney', 'AU');
 * console.log(result.timezone); // 'Australia/Sydney'
 * console.log(result.confidence); // 'high'
 * ```
 * 
 * @example
 * ```typescript
 * const result = calculateTimezone('New York', 'US');
 * console.log(result.timezone); // 'America/New_York' (first in list)
 * console.log(result.confidence); // 'medium'
 * console.log(result.multipleTimezones); // true
 * ```
 */
export function calculateTimezone(
  city: string,
  countryCode: string,
  options: TimezoneCalculationOptions = {}
): TimezoneCalculationResult {
  const {
    fallbackTimezone = 'UTC',
    verbose = false
  } = options;

  // Normalize country code
  const normalizedCountryCode = countryCode.toUpperCase().trim();

  if (verbose) {
    console.log(`[TimezoneCalculator] Calculating timezone for: ${city}, ${normalizedCountryCode}`);
  }

  // Get country data
  const country = ct.getCountry(normalizedCountryCode);

  // Country not found - use fallback
  if (!country || !country.timezones || country.timezones.length === 0) {
    if (verbose) {
      console.warn(`[TimezoneCalculator] Country not found or has no timezones: ${normalizedCountryCode}`);
    }

    return {
      timezone: fallbackTimezone,
      usedFallback: true,
      multipleTimezones: false,
      confidence: 'low'
    };
  }

  // Single timezone country - high confidence
  if (country.timezones.length === 1) {
    const timezone = country.timezones[0];

    if (verbose) {
      console.log(`[TimezoneCalculator] Single timezone country: ${timezone}`);
    }

    return {
      timezone,
      usedFallback: false,
      multipleTimezones: false,
      confidence: 'high'
    };
  }

  // Multiple timezone country - try city-level precision for Australia
  if (normalizedCountryCode === 'AU' && city) {
    const cityTimezone = getAustralianCityTimezone(city);

    if (cityTimezone) {
      if (verbose) {
        console.log(`[TimezoneCalculator] Australian city matched: ${city} → ${cityTimezone}`);
      }

      return {
        timezone: cityTimezone,
        usedFallback: false,
        multipleTimezones: true,
        availableTimezones: country.timezones,
        confidence: 'high' // High confidence for city-level match
      };
    }

    if (verbose) {
      console.log(`[TimezoneCalculator] Australian city not in mapping: ${city}`);
      console.log(`[TimezoneCalculator] Falling back to Sydney timezone (most populous)`);
    }

    // Fallback to Sydney for unknown Australian cities (most populous)
    return {
      timezone: 'Australia/Sydney',
      usedFallback: false,
      multipleTimezones: true,
      availableTimezones: country.timezones,
      confidence: 'medium'
    };
  }

  // Multiple timezone country (non-AU) - use first (usually most populous)
  const defaultTimezone = country.timezones[0];

  if (verbose) {
    console.log(`[TimezoneCalculator] Multi-timezone country: ${normalizedCountryCode}`);
    console.log(`[TimezoneCalculator] Selected: ${defaultTimezone}`);
    console.log(`[TimezoneCalculator] Available: ${country.timezones.join(', ')}`);
    console.log(`[TimezoneCalculator] Note: Using default timezone for country.`);
  }

  return {
    timezone: defaultTimezone,
    usedFallback: false,
    multipleTimezones: true,
    availableTimezones: country.timezones,
    confidence: 'medium'
  };
}

/**
 * Validate if a timezone string is a valid IANA timezone
 *
 * @param timezone - Timezone string to validate
 * @returns true if valid IANA timezone
 *
 * @example
 * ```typescript
 * isValidTimezone('Australia/Sydney'); // true
 * isValidTimezone('Invalid/Timezone'); // false
 * isValidTimezone('EST'); // false (abbreviations not allowed)
 * ```
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    // Check if timezone follows IANA format (Region/City) or is UTC
    // Reject abbreviations like EST, PST, GMT+10, etc.
    if (timezone !== 'UTC' && !timezone.includes('/')) {
      return false;
    }

    // Additional validation using Intl API
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all timezones for a country
 * 
 * @param countryCode - ISO 3166-1 alpha-2 country code
 * @returns Array of IANA timezones, or empty array if country not found
 * 
 * @example
 * ```typescript
 * getCountryTimezones('AU');
 * // ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', ...]
 * ```
 */
export function getCountryTimezones(countryCode: string): string[] {
  const normalizedCountryCode = countryCode.toUpperCase().trim();
  const country = ct.getCountry(normalizedCountryCode);
  
  if (!country || !country.timezones) {
    return [];
  }

  return country.timezones;
}

/**
 * Get country information including timezones
 * 
 * @param countryCode - ISO 3166-1 alpha-2 country code
 * @returns Country data or null if not found
 * 
 * @example
 * ```typescript
 * const aus = getCountryInfo('AU');
 * console.log(aus.name); // 'Australia'
 * console.log(aus.timezones); // ['Australia/Sydney', ...]
 * ```
 */
export function getCountryInfo(countryCode: string) {
  const normalizedCountryCode = countryCode.toUpperCase().trim();
  return ct.getCountry(normalizedCountryCode);
}

/**
 * Calculate timezone with logging support (for use with Logger instance)
 * 
 * @param city - City name
 * @param countryCode - ISO 3166-1 alpha-2 country code
 * @param logger - Logger instance (optional)
 * @returns Timezone calculation result
 * 
 * @example
 * ```typescript
 * import { logger } from '../logger';
 * 
 * const result = calculateTimezoneWithLogger('Sydney', 'AU', logger);
 * // Logs to your application logger
 * ```
 */
export function calculateTimezoneWithLogger(
  city: string,
  countryCode: string,
  logger?: { debug?: Function; warn?: Function; info?: Function }
): TimezoneCalculationResult {
  const normalizedCountryCode = countryCode.toUpperCase().trim();

  logger?.debug?.('Calculating timezone', { city, countryCode: normalizedCountryCode });

  const country = ct.getCountry(normalizedCountryCode);

  // Country not found
  if (!country || !country.timezones || country.timezones.length === 0) {
    logger?.warn?.('Country not found or has no timezones', { countryCode: normalizedCountryCode });
    
    return {
      timezone: 'UTC',
      usedFallback: true,
      multipleTimezones: false,
      confidence: 'low'
    };
  }

  // Single timezone country
  if (country.timezones.length === 1) {
    const timezone = country.timezones[0];
    logger?.debug?.('Single timezone country', { timezone });

    return {
      timezone,
      usedFallback: false,
      multipleTimezones: false,
      confidence: 'high'
    };
  }

  // Multiple timezone country - try city-level precision for Australia
  if (normalizedCountryCode === 'AU' && city) {
    const cityTimezone = getAustralianCityTimezone(city);

    if (cityTimezone) {
      logger?.debug?.('Australian city matched', { city, timezone: cityTimezone });

      return {
        timezone: cityTimezone,
        usedFallback: false,
        multipleTimezones: true,
        availableTimezones: country.timezones,
        confidence: 'high'
      };
    }

    logger?.info?.('Australian city not in mapping, using Sydney default', { city });

    return {
      timezone: 'Australia/Sydney',
      usedFallback: false,
      multipleTimezones: true,
      availableTimezones: country.timezones,
      confidence: 'medium'
    };
  }

  // Multiple timezone country (non-AU)
  const defaultTimezone = country.timezones[0];

  logger?.info?.('Multi-timezone country - using default', {
    countryCode: normalizedCountryCode,
    selectedTimezone: defaultTimezone,
    availableTimezones: country.timezones
  });

  return {
    timezone: defaultTimezone,
    usedFallback: false,
    multipleTimezones: true,
    availableTimezones: country.timezones,
    confidence: 'medium'
  };
}