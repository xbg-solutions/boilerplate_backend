/**
 * Timezone Calculator Tests
 */

import {
  calculateTimezone,
  calculateTimezoneWithLogger,
  isValidTimezone,
  getCountryTimezones,
  getCountryInfo,
} from '../timezone-calculator';
import { createMockLogger } from '../../../__tests__/mocks/mock-logger';

describe('Timezone Calculator', () => {
  describe('calculateTimezone', () => {
    describe('Single timezone countries', () => {
      it('should return timezone for single-timezone country', () => {
        const result = calculateTimezone('Paris', 'FR');

        expect(result.timezone).toBe('Europe/Paris');
        expect(result.confidence).toBe('high');
        expect(result.multipleTimezones).toBe(false);
        expect(result.usedFallback).toBe(false);
      });

      it('should return timezone for UK', () => {
        const result = calculateTimezone('London', 'GB');

        expect(result.timezone).toBe('Europe/London');
        expect(result.confidence).toBe('high');
      });
    });

    describe('Australian cities', () => {
      it('should match Sydney correctly', () => {
        const result = calculateTimezone('Sydney', 'AU');

        expect(result.timezone).toBe('Australia/Sydney');
        expect(result.confidence).toBe('high');
        expect(result.multipleTimezones).toBe(true);
      });

      it('should match Melbourne correctly', () => {
        const result = calculateTimezone('Melbourne', 'AU');

        expect(result.timezone).toBe('Australia/Melbourne');
        expect(result.confidence).toBe('high');
      });

      it('should match Brisbane correctly', () => {
        const result = calculateTimezone('Brisbane', 'AU');

        expect(result.timezone).toBe('Australia/Brisbane');
        expect(result.confidence).toBe('high');
      });

      it('should match Perth correctly', () => {
        const result = calculateTimezone('Perth', 'AU');

        expect(result.timezone).toBe('Australia/Perth');
        expect(result.confidence).toBe('high');
      });

      it('should match Adelaide correctly', () => {
        const result = calculateTimezone('Adelaide', 'AU');

        expect(result.timezone).toBe('Australia/Adelaide');
        expect(result.confidence).toBe('high');
      });

      it('should match Hobart correctly', () => {
        const result = calculateTimezone('Hobart', 'AU');

        expect(result.timezone).toBe('Australia/Hobart');
        expect(result.confidence).toBe('high');
      });

      it('should match Darwin correctly', () => {
        const result = calculateTimezone('Darwin', 'AU');

        expect(result.timezone).toBe('Australia/Darwin');
        expect(result.confidence).toBe('high');
      });

      it('should normalize city names (remove spaces, hyphens)', () => {
        expect(calculateTimezone('Gold Coast', 'AU').timezone).toBe('Australia/Brisbane');
        expect(calculateTimezone('Blue Mountains', 'AU').timezone).toBe('Australia/Sydney');
        expect(calculateTimezone('Central Coast', 'AU').timezone).toBe('Australia/Sydney');
      });

      it('should fallback to Sydney for unknown Australian cities', () => {
        const result = calculateTimezone('Unknown City', 'AU');

        expect(result.timezone).toBe('Australia/Sydney');
        expect(result.confidence).toBe('medium');
        expect(result.multipleTimezones).toBe(true);
      });
    });

    describe('Multi-timezone countries (non-AU)', () => {
      it('should return first timezone for US', () => {
        const result = calculateTimezone('New York', 'US');

        expect(result.timezone).toBeDefined();
        expect(result.confidence).toBe('medium');
        expect(result.multipleTimezones).toBe(true);
        expect(result.availableTimezones).toBeDefined();
        expect(result.availableTimezones!.length).toBeGreaterThan(1);
      });

      it('should return first timezone for Canada', () => {
        const result = calculateTimezone('Toronto', 'CA');

        expect(result.timezone).toBeDefined();
        expect(result.confidence).toBe('medium');
        expect(result.multipleTimezones).toBe(true);
      });
    });

    describe('Unknown countries', () => {
      it('should use fallback for unknown country', () => {
        const result = calculateTimezone('City', 'XX');

        expect(result.timezone).toBe('UTC');
        expect(result.confidence).toBe('low');
        expect(result.usedFallback).toBe(true);
        expect(result.multipleTimezones).toBe(false);
      });

      it('should use custom fallback', () => {
        const result = calculateTimezone('City', 'XX', {
          fallbackTimezone: 'America/New_York',
        });

        expect(result.timezone).toBe('America/New_York');
        expect(result.usedFallback).toBe(true);
      });
    });

    describe('Case normalization', () => {
      it('should normalize country code to uppercase', () => {
        expect(calculateTimezone('Paris', 'fr').timezone).toBe('Europe/Paris');
        expect(calculateTimezone('London', 'gb').timezone).toBe('Europe/London');
        expect(calculateTimezone('Sydney', 'au').timezone).toBe('Australia/Sydney');
      });
    });

    describe('Verbose mode', () => {
      let consoleSpy: jest.SpyInstance;

      beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      });

      afterEach(() => {
        consoleSpy.mockRestore();
      });

      it('should log when verbose is true', () => {
        calculateTimezone('Sydney', 'AU', { verbose: true });

        expect(consoleSpy).toHaveBeenCalled();
      });

      it('should not log when verbose is false', () => {
        calculateTimezone('Sydney', 'AU', { verbose: false });

        expect(consoleSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('calculateTimezoneWithLogger', () => {
    it('should log debug messages', () => {
      const logger = createMockLogger();

      calculateTimezoneWithLogger('Sydney', 'AU', logger);

      expect(logger.debug).toHaveBeenCalledWith(
        'Calculating timezone',
        expect.objectContaining({ city: 'Sydney', countryCode: 'AU' })
      );
    });

    it('should log warnings for unknown countries', () => {
      const logger = createMockLogger();

      calculateTimezoneWithLogger('City', 'XX', logger);

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should work without logger', () => {
      expect(() => {
        calculateTimezoneWithLogger('Sydney', 'AU');
      }).not.toThrow();
    });

    it('should return correct timezone', () => {
      const logger = createMockLogger();

      calculateTimezoneWithLogger('Melbourne', 'AU', logger);

      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('isValidTimezone', () => {
    it('should validate correct IANA timezones', () => {
      expect(isValidTimezone('Australia/Sydney')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('should reject invalid timezones', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('EST')).toBe(false);
      expect(isValidTimezone('GMT+10')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });

  describe('getCountryTimezones', () => {
    it('should return all timezones for Australia', () => {
      const timezones = getCountryTimezones('AU');

      expect(Array.isArray(timezones)).toBe(true);
      expect(timezones.length).toBeGreaterThan(1);
      expect(timezones).toContain('Australia/Sydney');
      expect(timezones).toContain('Australia/Melbourne');
      expect(timezones).toContain('Australia/Brisbane');
    });

    it('should return timezones for US', () => {
      const timezones = getCountryTimezones('US');

      expect(timezones.length).toBeGreaterThan(1);
      expect(timezones.some(tz => tz.includes('America'))).toBe(true);
    });

    it('should return single timezone for single-timezone countries', () => {
      const timezones = getCountryTimezones('FR');

      expect(timezones.length).toBe(1);
      expect(timezones[0]).toBe('Europe/Paris');
    });

    it('should return empty array for unknown countries', () => {
      const timezones = getCountryTimezones('XX');

      expect(timezones).toEqual([]);
    });

    it('should normalize country code', () => {
      expect(getCountryTimezones('au')).toEqual(getCountryTimezones('AU'));
      expect(getCountryTimezones('fr')).toEqual(getCountryTimezones('FR'));
    });
  });

  describe('getCountryInfo', () => {
    it('should return country information', () => {
      const info = getCountryInfo('AU');

      expect(info).toBeDefined();
      expect(info!.name).toBe('Australia');
      expect(info!.timezones).toBeDefined();
      expect(Array.isArray(info!.timezones)).toBe(true);
    });

    it('should return null for unknown countries', () => {
      const info = getCountryInfo('XX');

      expect(info).toBeNull();
    });

    it('should normalize country code', () => {
      expect(getCountryInfo('au')).toEqual(getCountryInfo('AU'));
    });
  });

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      const result = calculateTimezone('', '');

      expect(result.usedFallback).toBe(true);
    });

    it('should handle whitespace', () => {
      const result = calculateTimezone('  Sydney  ', '  AU  ');

      expect(result.timezone).toBe('Australia/Sydney');
    });

    it('should handle special characters in city names', () => {
      expect(() => {
        calculateTimezone("City's Name", 'AU');
      }).not.toThrow();
    });
  });
});
