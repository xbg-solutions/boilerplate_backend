/**
 * Journey Connector - Unit Tests
 *
 * Testing WHAT the journey connector does, not HOW it works internally:
 * - Creates/updates contacts in marketing automation
 * - Enrolls contacts in journeys/campaigns
 * - Tracks custom activities and events
 * - Manages list subscriptions
 * - Retrieves journeys and segments
 * - Manages contact tags
 * - Provides provider abstraction for marketing platforms (Ortto, HubSpot, etc.)
 */

import { JourneyConnector, JourneyProvider } from '../journey-connector';
import {
  JourneyContact,
  JourneyEnrollment,
  ActivityEvent,
  ListSubscription,
  Journey,
  JourneySegment,
  JourneyResponse,
} from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Journey Connector', () => {
  let mockProvider: jest.Mocked<JourneyProvider>;
  let connector: JourneyConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      upsertContact: jest.fn(),
      enrollInJourney: jest.fn(),
      unenrollFromJourney: jest.fn(),
      trackActivity: jest.fn(),
      subscribeToList: jest.fn(),
      unsubscribeFromList: jest.fn(),
      getJourneys: jest.fn(),
      getSegments: jest.fn(),
      addTags: jest.fn(),
      removeTags: jest.fn(),
    };

    connector = new JourneyConnector(mockProvider);
  });

  describe('upsertContact', () => {
    it('creates or updates contact successfully', async () => {
      const contact: JourneyContact = {
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        customFields: {
          company: 'Acme Corp',
          role: 'Manager',
        },
        tags: ['customer', 'premium'],
      };

      const response: JourneyResponse = {
        success: true,
        contactIds: ['contact-123'],
      };

      mockProvider.upsertContact.mockResolvedValue(response);

      const result = await connector.upsertContact(contact);

      expect(mockProvider.upsertContact).toHaveBeenCalledWith(contact);
      expect(result.success).toBe(true);
      expect(result.contactIds).toEqual(['contact-123']);
    });

    it('logs contact upsert', async () => {
      const contact: JourneyContact = {
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      };

      const response: JourneyResponse = { success: true };
      mockProvider.upsertContact.mockResolvedValue(response);

      await connector.upsertContact(contact);

      expect(logger.info).toHaveBeenCalledWith(
        'Upserting contact in journey system',
        expect.objectContaining({
          email: 'jane@example.com',
        })
      );

      expect(logger.info).toHaveBeenCalledWith('Contact upserted successfully');
    });

    it('handles upsert failures', async () => {
      const contact: JourneyContact = {
        email: 'invalid@example.com',
      };

      const response: JourneyResponse = {
        success: false,
        errors: [{ email: 'invalid@example.com', error: 'Invalid email format' }],
      };

      mockProvider.upsertContact.mockResolvedValue(response);

      const result = await connector.upsertContact(contact);

      expect(result.success).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to upsert contact',
        expect.objectContaining({
          errors: response.errors,
        })
      );
    });

    it('handles provider errors', async () => {
      const contact: JourneyContact = {
        email: 'test@example.com',
      };

      mockProvider.upsertContact.mockRejectedValue(new Error('Provider error'));

      await expect(connector.upsertContact(contact)).rejects.toThrow('Provider error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('enrollInJourney', () => {
    it('enrolls contacts in journey successfully', async () => {
      const enrollment: JourneyEnrollment = {
        journeyId: 'journey-123',
        contacts: [
          {
            email: 'user1@example.com',
            firstName: 'User',
            lastName: 'One',
          },
          {
            email: 'user2@example.com',
            firstName: 'User',
            lastName: 'Two',
          },
        ],
        data: {
          source: 'website',
          campaign: 'spring-sale',
        },
      };

      const response: JourneyResponse = {
        success: true,
        contactIds: ['contact-1', 'contact-2'],
      };

      mockProvider.enrollInJourney.mockResolvedValue(response);

      const result = await connector.enrollInJourney(enrollment);

      expect(mockProvider.enrollInJourney).toHaveBeenCalledWith(enrollment);
      expect(result.success).toBe(true);
      expect(result.contactIds).toHaveLength(2);
    });

    it('logs enrollment details', async () => {
      const enrollment: JourneyEnrollment = {
        journeyId: 'journey-456',
        contacts: [
          { email: 'test1@example.com' },
          { email: 'test2@example.com' },
          { email: 'test3@example.com' },
        ],
      };

      const response: JourneyResponse = {
        success: true,
        contactIds: ['c1', 'c2', 'c3'],
      };

      mockProvider.enrollInJourney.mockResolvedValue(response);

      await connector.enrollInJourney(enrollment);

      expect(logger.info).toHaveBeenCalledWith(
        'Enrolling contacts in journey',
        expect.objectContaining({
          journeyId: 'journey-456',
          contactCount: 3,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Journey enrollment completed',
        expect.objectContaining({
          success: true,
          enrolledCount: 3,
        })
      );
    });

    it('handles enrollment errors', async () => {
      const enrollment: JourneyEnrollment = {
        journeyId: 'journey-error',
        contacts: [{ email: 'test@example.com' }],
      };

      mockProvider.enrollInJourney.mockRejectedValue(new Error('Journey not found'));

      await expect(connector.enrollInJourney(enrollment)).rejects.toThrow('Journey not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('unenrollFromJourney', () => {
    it('removes contact from journey', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.unenrollFromJourney.mockResolvedValue(response);

      const result = await connector.unenrollFromJourney('journey-123', 'user@example.com');

      expect(mockProvider.unenrollFromJourney).toHaveBeenCalledWith('journey-123', 'user@example.com');
      expect(result.success).toBe(true);
    });

    it('logs unenrollment', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.unenrollFromJourney.mockResolvedValue(response);

      await connector.unenrollFromJourney('journey-789', 'test@example.com');

      expect(logger.info).toHaveBeenCalledWith(
        'Unenrolling contact from journey',
        expect.objectContaining({
          journeyId: 'journey-789',
          email: 'test@example.com',
        })
      );
    });

    it('handles unenrollment errors', async () => {
      mockProvider.unenrollFromJourney.mockRejectedValue(new Error('Contact not enrolled'));

      await expect(
        connector.unenrollFromJourney('journey-123', 'user@example.com')
      ).rejects.toThrow('Contact not enrolled');

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('trackActivity', () => {
    it('tracks custom activity successfully', async () => {
      const event: ActivityEvent = {
        email: 'user@example.com',
        activityId: 'product-viewed',
        timestamp: new Date(),
        data: {
          productId: 'prod-123',
          productName: 'Widget Pro',
          price: 99.99,
        },
      };

      const response: JourneyResponse = { success: true };
      mockProvider.trackActivity.mockResolvedValue(response);

      const result = await connector.trackActivity(event);

      expect(mockProvider.trackActivity).toHaveBeenCalledWith(event);
      expect(result.success).toBe(true);
    });

    it('logs activity tracking', async () => {
      const event: ActivityEvent = {
        email: 'customer@example.com',
        activityId: 'checkout-started',
      };

      const response: JourneyResponse = { success: true };
      mockProvider.trackActivity.mockResolvedValue(response);

      await connector.trackActivity(event);

      expect(logger.info).toHaveBeenCalledWith(
        'Tracking activity',
        expect.objectContaining({
          email: 'customer@example.com',
          activityId: 'checkout-started',
        })
      );
    });

    it('handles activity tracking errors', async () => {
      const event: ActivityEvent = {
        email: 'test@example.com',
        activityId: 'invalid-activity',
      };

      mockProvider.trackActivity.mockRejectedValue(new Error('Invalid activity ID'));

      await expect(connector.trackActivity(event)).rejects.toThrow('Invalid activity ID');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('subscribeToList', () => {
    it('subscribes contact to list successfully', async () => {
      const subscription: ListSubscription = {
        email: 'user@example.com',
        listId: 'list-newsletter',
        customFields: {
          preferences: 'weekly-digest',
        },
      };

      const response: JourneyResponse = { success: true };
      mockProvider.subscribeToList.mockResolvedValue(response);

      const result = await connector.subscribeToList(subscription);

      expect(mockProvider.subscribeToList).toHaveBeenCalledWith(subscription);
      expect(result.success).toBe(true);
    });

    it('logs list subscription', async () => {
      const subscription: ListSubscription = {
        email: 'subscriber@example.com',
        listId: 'list-updates',
      };

      const response: JourneyResponse = { success: true };
      mockProvider.subscribeToList.mockResolvedValue(response);

      await connector.subscribeToList(subscription);

      expect(logger.info).toHaveBeenCalledWith(
        'Subscribing to list',
        expect.objectContaining({
          email: 'subscriber@example.com',
          listId: 'list-updates',
        })
      );
    });

    it('handles subscription errors', async () => {
      const subscription: ListSubscription = {
        email: 'test@example.com',
        listId: 'nonexistent-list',
      };

      mockProvider.subscribeToList.mockRejectedValue(new Error('List not found'));

      await expect(connector.subscribeToList(subscription)).rejects.toThrow('List not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('unsubscribeFromList', () => {
    it('unsubscribes contact from list', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.unsubscribeFromList.mockResolvedValue(response);

      const result = await connector.unsubscribeFromList('list-123', 'user@example.com');

      expect(mockProvider.unsubscribeFromList).toHaveBeenCalledWith('list-123', 'user@example.com');
      expect(result.success).toBe(true);
    });

    it('logs unsubscription', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.unsubscribeFromList.mockResolvedValue(response);

      await connector.unsubscribeFromList('list-newsletter', 'unsubscribe@example.com');

      expect(logger.info).toHaveBeenCalledWith(
        'Unsubscribing from list',
        expect.objectContaining({
          email: 'unsubscribe@example.com',
          listId: 'list-newsletter',
        })
      );
    });

    it('handles unsubscription errors', async () => {
      mockProvider.unsubscribeFromList.mockRejectedValue(new Error('Contact not found'));

      await expect(
        connector.unsubscribeFromList('list-123', 'user@example.com')
      ).rejects.toThrow('Contact not found');

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getJourneys', () => {
    it('retrieves all journeys', async () => {
      const journeys: Journey[] = [
        {
          id: 'journey-1',
          name: 'Welcome Series',
          status: 'active',
          type: 'email',
          enrolledCount: 150,
          completedCount: 75,
        },
        {
          id: 'journey-2',
          name: 'Onboarding Flow',
          status: 'active',
          type: 'multi-channel',
          enrolledCount: 200,
          completedCount: 120,
        },
      ];

      mockProvider.getJourneys.mockResolvedValue(journeys);

      const result = await connector.getJourneys();

      expect(mockProvider.getJourneys).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Welcome Series');
      expect(result[1].status).toBe('active');
    });

    it('returns empty array when no journeys', async () => {
      mockProvider.getJourneys.mockResolvedValue([]);

      const result = await connector.getJourneys();

      expect(result).toHaveLength(0);
    });

    it('handles fetch errors', async () => {
      mockProvider.getJourneys.mockRejectedValue(new Error('API error'));

      await expect(connector.getJourneys()).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getSegments', () => {
    it('retrieves all segments', async () => {
      const segments: JourneySegment[] = [
        {
          id: 'segment-1',
          name: 'Active Customers',
          description: 'Customers with purchases in last 90 days',
          conditions: { lastPurchase: { days: 90 } },
        },
        {
          id: 'segment-2',
          name: 'High Value',
          description: 'Lifetime value over $1000',
          conditions: { ltv: { gt: 1000 } },
        },
      ];

      mockProvider.getSegments.mockResolvedValue(segments);

      const result = await connector.getSegments();

      expect(mockProvider.getSegments).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Active Customers');
      expect(result[1].description).toBe('Lifetime value over $1000');
    });

    it('returns empty array when no segments', async () => {
      mockProvider.getSegments.mockResolvedValue([]);

      const result = await connector.getSegments();

      expect(result).toHaveLength(0);
    });

    it('handles fetch errors', async () => {
      mockProvider.getSegments.mockRejectedValue(new Error('API error'));

      await expect(connector.getSegments()).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('addTags', () => {
    it('adds tags to contact successfully', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.addTags.mockResolvedValue(response);

      const result = await connector.addTags('user@example.com', ['vip', 'premium', 'loyal']);

      expect(mockProvider.addTags).toHaveBeenCalledWith('user@example.com', ['vip', 'premium', 'loyal']);
      expect(result.success).toBe(true);
    });

    it('logs tag addition', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.addTags.mockResolvedValue(response);

      await connector.addTags('customer@example.com', ['new-customer']);

      expect(logger.info).toHaveBeenCalledWith(
        'Adding tags to contact',
        expect.objectContaining({
          email: 'customer@example.com',
          tags: ['new-customer'],
        })
      );
    });

    it('handles empty tag array', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.addTags.mockResolvedValue(response);

      const result = await connector.addTags('user@example.com', []);

      expect(result.success).toBe(true);
    });

    it('handles tag addition errors', async () => {
      mockProvider.addTags.mockRejectedValue(new Error('Contact not found'));

      await expect(connector.addTags('user@example.com', ['test'])).rejects.toThrow('Contact not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('removeTags', () => {
    it('removes tags from contact successfully', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.removeTags.mockResolvedValue(response);

      const result = await connector.removeTags('user@example.com', ['trial', 'unverified']);

      expect(mockProvider.removeTags).toHaveBeenCalledWith('user@example.com', ['trial', 'unverified']);
      expect(result.success).toBe(true);
    });

    it('logs tag removal', async () => {
      const response: JourneyResponse = { success: true };
      mockProvider.removeTags.mockResolvedValue(response);

      await connector.removeTags('customer@example.com', ['outdated']);

      expect(logger.info).toHaveBeenCalledWith(
        'Removing tags from contact',
        expect.objectContaining({
          email: 'customer@example.com',
          tags: ['outdated'],
        })
      );
    });

    it('handles tag removal errors', async () => {
      mockProvider.removeTags.mockRejectedValue(new Error('Contact not found'));

      await expect(connector.removeTags('user@example.com', ['test'])).rejects.toThrow('Contact not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockProvider.upsertContact.mockRejectedValue('String error');

      await expect(
        connector.upsertContact({ email: 'test@example.com' })
      ).rejects.toBe('String error');

      expect(logger.error).toHaveBeenCalled();
    });

    it('logs all errors appropriately', async () => {
      mockProvider.trackActivity.mockRejectedValue(new Error('Test error'));

      await expect(
        connector.trackActivity({
          email: 'test@example.com',
          activityId: 'test',
        })
      ).rejects.toThrow('Test error');

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracking activity',
        expect.any(Error)
      );
    });
  });
});
