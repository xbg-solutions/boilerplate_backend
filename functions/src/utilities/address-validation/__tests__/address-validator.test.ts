/**
 * Address Validator - Unit Tests
 *
 * Testing WHAT the address validator does, not HOW it works internally:
 * - Validates addresses using Google Maps Geocoding API
 * - Returns validation results with formatted address and location
 * - Handles various API responses and errors
 * - Falls back gracefully when API is not configured
 */

import { addressValidator, AddressComponents } from '../address-validator';
import { Logger } from '../../logger';
import { ValidationError } from '../../errors';
import { Status } from '@googlemaps/google-maps-services-js';

// Mock dependencies
jest.mock('../../../config/maps.config', () => ({
  isGoogleMapsConfigured: jest.fn(),
  getGoogleMapsApiKey: jest.fn(),
}));

jest.mock('@googlemaps/google-maps-services-js', () => ({
  Client: jest.fn(),
  Status: {
    OK: 'OK',
    ZERO_RESULTS: 'ZERO_RESULTS',
    INVALID_REQUEST: 'INVALID_REQUEST',
    OVER_QUERY_LIMIT: 'OVER_QUERY_LIMIT',
    REQUEST_DENIED: 'REQUEST_DENIED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  },
}));

import { Client } from '@googlemaps/google-maps-services-js';
import { isGoogleMapsConfigured, getGoogleMapsApiKey } from '../../../config/maps.config';

describe('Address Validator', () => {
  let mockLogger: Logger;
  let mockGeocode: jest.Mock;

  beforeEach(() => {
    mockLogger = new Logger('test-correlation-id');
    mockGeocode = jest.fn();

    // Clear all mocks first
    jest.clearAllMocks();

    // Mock the Client constructor to return an object with geocode method
    (Client as jest.Mock).mockImplementation(() => ({
      geocode: mockGeocode,
    }));

    // Default: Google Maps is configured
    (isGoogleMapsConfigured as jest.Mock).mockReturnValue(true);
    (getGoogleMapsApiKey as jest.Mock).mockReturnValue('test-api-key');

    // Reset the mock implementation to ensure fresh state
    mockGeocode.mockReset();
  });

  describe('validateAddress', () => {
    const validAddress: AddressComponents = {
      addressLine1: '1600 Amphitheatre Parkway',
      city: 'Mountain View',
      state: 'CA',
      postalCode: '94043',
      country: 'US',
    };

    it('validates a correct address successfully', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
              geometry: {
                location: {
                  lat: 37.4224764,
                  lng: -122.0842499,
                },
              },
              types: ['street_address'],
              address_components: [
                {
                  long_name: 'United States',
                  short_name: 'US',
                  types: ['country', 'political'],
                },
                {
                  long_name: 'Mountain View',
                  short_name: 'Mountain View',
                  types: ['locality', 'political'],
                },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.formattedAddress).toBe('1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA');
      expect(result.location).toEqual({
        lat: 37.4224764,
        lng: -122.0842499,
      });
    });

    it('calls Google Maps API with correct parameters', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
              geometry: { location: { lat: 37.4224764, lng: -122.0842499 } },
              types: ['street_address'],
              address_components: [
                { short_name: 'US', types: ['country'] },
                { short_name: 'Mountain View', types: ['locality'] },
              ],
            },
          ],
        },
      });

      await addressValidator.validateAddress(validAddress, mockLogger);

      expect(mockGeocode).toHaveBeenCalledWith({
        params: {
          address: '1600 Amphitheatre Parkway, Mountain View, CA, 94043, US',
          key: 'test-api-key',
        },
        timeout: 5000,
      });
    });

    it('builds address string correctly with all components', async () => {
      const address: AddressComponents = {
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4B',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: '123 Main St Apt 4B, New York, NY 10001, USA',
              geometry: { location: { lat: 40.7128, lng: -74.0060 } },
              types: ['street_address'],
              address_components: [
                { short_name: 'US', types: ['country'] },
                { short_name: 'New York', types: ['locality'] },
              ],
            },
          ],
        },
      });

      await addressValidator.validateAddress(address, mockLogger);

      expect(mockGeocode).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            address: '123 Main St, Apt 4B, New York, NY, 10001, US',
          }),
        })
      );
    });

    it('builds address string without optional components', async () => {
      const address: AddressComponents = {
        city: 'Sydney',
        country: 'AU',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney NSW, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      await addressValidator.validateAddress(address, mockLogger);

      expect(mockGeocode).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            address: 'Sydney, AU',
          }),
        })
      );
    });

    it('returns isValid false when address not found', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.ZERO_RESULTS,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Address not found');
    });

    it('returns isValid false when API returns no results', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Address not found');
    });

    it('handles invalid request error', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.INVALID_REQUEST,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Invalid address format');
    });

    it('handles query limit exceeded error', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OVER_QUERY_LIMIT,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Validation service temporarily unavailable');
    });

    it('handles request denied error', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.REQUEST_DENIED,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Validation service configuration error');
    });

    it('handles unknown error', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.UNKNOWN_ERROR,
          results: [],
        },
      });

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Validation service error');
    });

    it('rejects address that is too generic (country only)', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'United States',
              geometry: { location: { lat: 37.0902, lng: -95.7129 } },
              types: ['country', 'political'],
              address_components: [
                { short_name: 'US', types: ['country'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress({ city: 'USA', country: 'US' }, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('too generic');
    });

    it('rejects address that is too generic (state only)', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'California, USA',
              geometry: { location: { lat: 36.7783, lng: -119.4179 } },
              types: ['administrative_area_level_1', 'political'],
              address_components: [
                { short_name: 'US', types: ['country'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress({ city: 'CA', country: 'US' }, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('too generic');
    });

    it('accepts address with city (not too generic)', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney NSW, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality', 'political'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress({ city: 'Sydney', country: 'AU' }, mockLogger);

      expect(result.isValid).toBe(true);
    });

    it('rejects address with country mismatch', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      // Request says US, but result is AU
      const result = await addressValidator.validateAddress({ city: 'Sydney', country: 'US' }, mockLogger);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('country mismatch');
      expect(result.reason).toContain('US');
      expect(result.reason).toContain('AU');
    });

    it('handles country code case-insensitively', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Mountain View, CA, USA',
              geometry: { location: { lat: 37.4224764, lng: -122.0842499 } },
              types: ['locality'],
              address_components: [
                { short_name: 'US', types: ['country'] },
                { short_name: 'Mountain View', types: ['locality'] },
              ],
            },
          ],
        },
      });

      // Request uses lowercase 'us'
      const result = await addressValidator.validateAddress({ city: 'Mountain View', country: 'us' }, mockLogger);

      expect(result.isValid).toBe(true);
    });

    it('allows addresses when Google Maps API not configured', async () => {
      (isGoogleMapsConfigured as jest.Mock).mockReturnValue(false);

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.reason).toContain('not configured');
      expect(mockGeocode).not.toHaveBeenCalled();
    });

    it('allows addresses when API call throws error', async () => {
      mockGeocode.mockRejectedValue(new Error('Network error'));

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.reason).toContain('API error');
    });

    it('allows addresses when API times out', async () => {
      mockGeocode.mockRejectedValue(new Error('Timeout'));

      const result = await addressValidator.validateAddress(validAddress, mockLogger);

      expect(result.isValid).toBe(true);
      expect(result.reason).toContain('API error');
    });

    it('handles null values in optional address fields', async () => {
      const address: AddressComponents = {
        addressLine1: null,
        addressLine2: null,
        city: 'Sydney',
        state: null,
        postalCode: null,
        country: 'AU',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney NSW, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(address, mockLogger);

      expect(result.isValid).toBe(true);
      expect(mockGeocode).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            address: 'Sydney, AU',
          }),
        })
      );
    });
  });

  describe('validateAddressOrThrow', () => {
    const validAddress: AddressComponents = {
      city: 'Mountain View',
      country: 'US',
    };

    it('does not throw when address is valid', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Mountain View, CA, USA',
              geometry: { location: { lat: 37.4224764, lng: -122.0842499 } },
              types: ['locality'],
              address_components: [
                { short_name: 'US', types: ['country'] },
                { short_name: 'Mountain View', types: ['locality'] },
              ],
            },
          ],
        },
      });

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).resolves.not.toThrow();
    });

    it('throws ValidationError when address is invalid', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.ZERO_RESULTS,
          results: [],
        },
      });

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).rejects.toThrow(ValidationError);

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).rejects.toThrow('Invalid address: Address not found');
    });

    it('throws ValidationError with reason from API', async () => {
      mockGeocode.mockResolvedValue({
        data: {
          status: Status.INVALID_REQUEST,
          results: [],
        },
      });

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).rejects.toThrow('Invalid address: Invalid address format');
    });

    it('does not throw when API is not configured', async () => {
      (isGoogleMapsConfigured as jest.Mock).mockReturnValue(false);

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).resolves.not.toThrow();
    });

    it('does not throw when API call fails', async () => {
      mockGeocode.mockRejectedValue(new Error('Network error'));

      await expect(
        addressValidator.validateAddressOrThrow(validAddress, mockLogger)
      ).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles very long address lines', async () => {
      const address: AddressComponents = {
        addressLine1: 'A'.repeat(200),
        city: 'Sydney',
        country: 'AU',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney NSW, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(address, mockLogger);

      expect(result.isValid).toBe(true);
    });

    it('handles special characters in address', async () => {
      const address: AddressComponents = {
        addressLine1: "O'Brien's St & Co.",
        city: 'Montréal',
        country: 'CA',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: "O'Brien's St & Co., Montréal, QC, Canada",
              geometry: { location: { lat: 45.5017, lng: -73.5673 } },
              types: ['street_address'],
              address_components: [
                { short_name: 'CA', types: ['country'] },
                { short_name: 'Montréal', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(address, mockLogger);

      expect(result.isValid).toBe(true);
    });

    it('handles unicode characters in address', async () => {
      const address: AddressComponents = {
        city: '东京', // Tokyo in Chinese characters
        country: 'JP',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: '日本、東京',
              geometry: { location: { lat: 35.6762, lng: 139.6503 } },
              types: ['locality'],
              address_components: [
                { short_name: 'JP', types: ['country'] },
                { short_name: '東京', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(address, mockLogger);

      expect(result.isValid).toBe(true);
    });

    it('handles empty strings in optional fields', async () => {
      const address: AddressComponents = {
        addressLine1: '',
        addressLine2: '',
        city: 'Sydney',
        state: '',
        postalCode: '',
        country: 'AU',
      };

      mockGeocode.mockResolvedValue({
        data: {
          status: Status.OK,
          results: [
            {
              formatted_address: 'Sydney NSW, Australia',
              geometry: { location: { lat: -33.8688, lng: 151.2093 } },
              types: ['locality'],
              address_components: [
                { short_name: 'AU', types: ['country'] },
                { short_name: 'Sydney', types: ['locality'] },
              ],
            },
          ],
        },
      });

      const result = await addressValidator.validateAddress(address, mockLogger);

      expect(result.isValid).toBe(true);
    });
  });
});
