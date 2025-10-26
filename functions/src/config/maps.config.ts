/**
 * Google Maps API Configuration
 * Used for address validation and geocoding services
 */

export interface MapsConfig {
  apiKey: string;
  enabled: boolean;
  timeout: number;
  rateLimits?: {
    requestsPerSecond?: number;
    requestsPerDay?: number;
  };
}

/**
 * Load Google Maps configuration from environment
 */
export const MAPS_CONFIG: MapsConfig = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  enabled: !!process.env.GOOGLE_MAPS_API_KEY,
  timeout: parseInt(process.env.GOOGLE_MAPS_TIMEOUT || '5000', 10),
  rateLimits: {
    requestsPerSecond: parseInt(process.env.GOOGLE_MAPS_RATE_LIMIT_PER_SECOND || '50', 10),
    requestsPerDay: parseInt(process.env.GOOGLE_MAPS_RATE_LIMIT_PER_DAY || '100000', 10),
  },
};

/**
 * Get Google Maps API key
 * @throws Error if API key is not configured
 */
export function getGoogleMapsApiKey(): string {
  if (!MAPS_CONFIG.apiKey) {
    throw new Error('Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY environment variable.');
  }
  return MAPS_CONFIG.apiKey;
}

/**
 * Check if Google Maps is configured
 */
export function isGoogleMapsConfigured(): boolean {
  return MAPS_CONFIG.enabled;
}

/**
 * Validate Google Maps configuration
 */
export function validateMapsConfig(): void {
  if (MAPS_CONFIG.enabled && !MAPS_CONFIG.apiKey) {
    throw new Error('Google Maps API key is required when GOOGLE_MAPS_API_KEY is set');
  }

  if (MAPS_CONFIG.timeout < 1000 || MAPS_CONFIG.timeout > 30000) {
    throw new Error('Google Maps timeout must be between 1000 and 30000 milliseconds');
  }
}
