/**
 * Address Validation Service
 * Feature #25: Address Validation using Google Maps Geocoding API
 *
 * Simple "is this a real address" validation
 */

import { Client, GeocodeResult, Status } from '@googlemaps/google-maps-services-js';
import { getGoogleMapsApiKey, isGoogleMapsConfigured } from '../../config/maps.config';
import { ValidationError } from '../errors';
import { Logger } from '../logger';

/**
 * Address validation result
 */
export interface AddressValidationResult {
  isValid: boolean;
  reason?: string;
  formattedAddress?: string;
  location?: {
    lat: number;
    lng: number;
  };
}

/**
 * Address components for validation
 */
export interface AddressComponents {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string; // ISO 3166-1 alpha-2 code
}

class AddressValidator {
  private getClient(): Client {
    return new Client({});
  }

  /**
   * Validate an address using Google Maps Geocoding API
   * Feature #25: Simple "is this a real address" validation
   *
   * @param address - Address components to validate
   * @param logger - Logger instance
   * @returns Validation result with status and reason
   */
  async validateAddress(
    address: AddressComponents,
    logger: Logger
  ): Promise<AddressValidationResult> {
    logger.debug('Address validation: Starting', {
      city: address.city,
      country: address.country,
    });

    // Check if Google Maps is configured
    if (!isGoogleMapsConfigured()) {
      logger.warn('Address validation: Google Maps API not configured, skipping validation');
      return {
        isValid: true, // Allow addresses when API not configured
        reason: 'Validation skipped - API not configured',
      };
    }

    try {
      // Build address string for geocoding
      const addressString = this.buildAddressString(address);

      logger.debug('Address validation: Geocoding address', { addressString });

      // Call Google Maps Geocoding API
      const apiKey = getGoogleMapsApiKey();
      const client = this.getClient();
      const response = await client.geocode({
        params: {
          address: addressString,
          key: apiKey,
        },
        timeout: 5000, // 5 second timeout
      });

      // Check response status
      if (response.data.status !== Status.OK) {
        logger.debug('Address validation: Geocoding failed', {
          status: response.data.status,
        });

        return {
          isValid: false,
          reason: this.getReasonFromStatus(response.data.status),
        };
      }

      // Check if we got results
      if (!response.data.results || response.data.results.length === 0) {
        logger.debug('Address validation: No results found');
        return {
          isValid: false,
          reason: 'Address not found',
        };
      }

      // Get the first (best) result
      const result = response.data.results[0];

      // Validate result quality
      const qualityCheck = this.checkResultQuality(result, address);

      if (!qualityCheck.isValid) {
        logger.debug('Address validation: Quality check failed', {
          reason: qualityCheck.reason,
        });
        return qualityCheck;
      }

      logger.info('Address validation: Success', {
        formattedAddress: result.formatted_address,
      });

      return {
        isValid: true,
        formattedAddress: result.formatted_address,
        location: {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
        },
      };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Unknown error during address validation');
      logger.error('Address validation: Error occurred', errorObj);

      // Don't block address creation on API errors
      return {
        isValid: true,
        reason: 'Validation failed due to API error - address allowed',
      };
    }
  }

  /**
   * Validate address and throw error if invalid
   * Convenience method for use in service layer
   */
  async validateAddressOrThrow(
    address: AddressComponents,
    logger: Logger
  ): Promise<void> {
    const result = await this.validateAddress(address, logger);

    if (!result.isValid) {
      throw new ValidationError(`Invalid address: ${result.reason || 'Address could not be verified'}`);
    }
  }

  /**
   * Build address string from components
   */
  private buildAddressString(address: AddressComponents): string {
    const parts: string[] = [];

    if (address.addressLine1) {
      parts.push(address.addressLine1);
    }

    if (address.addressLine2) {
      parts.push(address.addressLine2);
    }

    parts.push(address.city);

    if (address.state) {
      parts.push(address.state);
    }

    if (address.postalCode) {
      parts.push(address.postalCode);
    }

    parts.push(address.country);

    return parts.join(', ');
  }

  /**
   * Get human-readable reason from Google Maps API status
   */
  private getReasonFromStatus(status: Status): string {
    switch (status) {
      case Status.ZERO_RESULTS:
        return 'Address not found';
      case Status.INVALID_REQUEST:
        return 'Invalid address format';
      case Status.OVER_QUERY_LIMIT:
        return 'Validation service temporarily unavailable';
      case Status.REQUEST_DENIED:
        return 'Validation service configuration error';
      case Status.UNKNOWN_ERROR:
        return 'Validation service error';
      default:
        return 'Address could not be verified';
    }
  }

  /**
   * Check quality of geocoding result
   * Ensures result is specific enough (not just country-level)
   */
  private checkResultQuality(
    result: GeocodeResult,
    originalAddress: AddressComponents
  ): AddressValidationResult {
    const { types, address_components } = result;

    // Reject if result is too generic (country or administrative_area_level_1 only)
    const isGeneric = (types as string[]).includes('country') || (types as string[]).includes('administrative_area_level_1');
    const hasCity = address_components.some((component) =>
      (component.types as string[]).includes('locality') || (component.types as string[]).includes('postal_town')
    );

    if (isGeneric && !hasCity) {
      return {
        isValid: false,
        reason: 'Address is too generic - please provide a more specific address',
      };
    }

    // Verify the country matches
    const countryComponent = address_components.find((component) =>
      (component.types as string[]).includes('country')
    );

    if (countryComponent) {
      const geocodedCountry = countryComponent.short_name.toUpperCase();
      const requestedCountry = originalAddress.country.toUpperCase();

      if (geocodedCountry !== requestedCountry) {
        return {
          isValid: false,
          reason: `Address country mismatch - expected ${requestedCountry}, found ${geocodedCountry}`,
        };
      }
    }

    return { isValid: true };
  }
}

// Export singleton instance
export const addressValidator = new AddressValidator();
