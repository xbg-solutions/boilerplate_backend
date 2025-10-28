/**
 * Push Notifications Connector - Unit Tests
 *
 * Testing WHAT the push notifications connector does, not HOW it works internally:
 * - Sends push notifications to single devices, topics, and conditions
 * - Sends multicast notifications to multiple devices
 * - Manages topic subscriptions and unsubscriptions
 * - Validates device tokens
 * - Handles success and error cases
 */

import { PushNotificationsConnector, PushNotificationsProvider } from '../push-notifications-connector';
import {
  SendNotificationRequest,
  SendNotificationResponse,
  TopicSubscriptionRequest,
  TopicSubscriptionResponse,
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

describe('Push Notifications Connector', () => {
  let mockProvider: jest.Mocked<PushNotificationsProvider>;
  let connector: PushNotificationsConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      send: jest.fn(),
      sendMulticast: jest.fn(),
      subscribeToTopic: jest.fn(),
      unsubscribeFromTopic: jest.fn(),
      validateToken: jest.fn(),
    };

    connector = new PushNotificationsConnector(mockProvider);
  });

  describe('send', () => {
    it('sends notification to single device token', async () => {
      const request: SendNotificationRequest = {
        target: {
          token: 'device-token-123',
        },
        notification: {
          title: 'Test Notification',
          body: 'This is a test message',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-123',
      };

      mockProvider.send.mockResolvedValue(response);

      const result = await connector.send(request);

      expect(mockProvider.send).toHaveBeenCalledWith(request);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('sends notification to topic', async () => {
      const request: SendNotificationRequest = {
        target: {
          topic: 'breaking-news',
        },
        notification: {
          title: 'Breaking News',
          body: 'Important update',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-456',
      };

      mockProvider.send.mockResolvedValue(response);

      const result = await connector.send(request);

      expect(result.success).toBe(true);
      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            topic: 'breaking-news',
          }),
        })
      );
    });

    it('sends notification with condition', async () => {
      const request: SendNotificationRequest = {
        target: {
          condition: "'sports' in topics && 'news' in topics",
        },
        notification: {
          title: 'Sports News',
          body: 'Match results',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-789',
      };

      mockProvider.send.mockResolvedValue(response);

      const result = await connector.send(request);

      expect(result.success).toBe(true);
      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            condition: "'sports' in topics && 'news' in topics",
          }),
        })
      );
    });

    it('sends notification with image', async () => {
      const request: SendNotificationRequest = {
        target: {
          token: 'device-token-123',
        },
        notification: {
          title: 'New Photo',
          body: 'Check out this image',
          imageUrl: 'https://example.com/image.jpg',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-abc',
      };

      mockProvider.send.mockResolvedValue(response);

      await connector.send(request);

      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: expect.objectContaining({
            imageUrl: 'https://example.com/image.jpg',
          }),
        })
      );
    });

    it('sends notification with custom data', async () => {
      const request: SendNotificationRequest = {
        target: {
          token: 'device-token-123',
        },
        notification: {
          title: 'Order Update',
          body: 'Your order has shipped',
          data: {
            orderId: 'order-123',
            status: 'shipped',
          },
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-def',
      };

      mockProvider.send.mockResolvedValue(response);

      await connector.send(request);

      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: expect.objectContaining({
            data: {
              orderId: 'order-123',
              status: 'shipped',
            },
          }),
        })
      );
    });

    it('sends notification with high priority', async () => {
      const request: SendNotificationRequest = {
        target: {
          token: 'device-token-123',
        },
        notification: {
          title: 'Urgent Alert',
          body: 'Action required',
        },
        options: {
          priority: 'high',
          ttl: 3600,
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-ghi',
      };

      mockProvider.send.mockResolvedValue(response);

      await connector.send(request);

      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            priority: 'high',
            ttl: 3600,
          }),
        })
      );
    });

    it('logs successful notification send', async () => {
      const request: SendNotificationRequest = {
        target: { token: 'device-token-123' },
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        messageId: 'msg-123',
      };

      mockProvider.send.mockResolvedValue(response);

      await connector.send(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Sending push notification',
        expect.objectContaining({
          title: 'Test',
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Push notification sent successfully',
        expect.objectContaining({
          messageId: 'msg-123',
        })
      );
    });

    it('logs failed notification send', async () => {
      const request: SendNotificationRequest = {
        target: { token: 'invalid-token' },
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      const response: SendNotificationResponse = {
        success: false,
        errors: [
          {
            token: 'invalid-token',
            error: 'Invalid registration token',
          },
        ],
      };

      mockProvider.send.mockResolvedValue(response);

      await connector.send(request);

      expect(logger.warn).toHaveBeenCalledWith(
        'Push notification failed',
        expect.objectContaining({
          errors: response.errors,
        })
      );
    });

    it('handles provider errors', async () => {
      const request: SendNotificationRequest = {
        target: { token: 'device-token-123' },
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      mockProvider.send.mockRejectedValue(new Error('Network error'));

      await expect(connector.send(request)).rejects.toThrow('Network error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('sendMulticast', () => {
    it('sends notification to multiple devices', async () => {
      const request: SendNotificationRequest = {
        target: {
          tokens: ['token-1', 'token-2', 'token-3'],
        },
        notification: {
          title: 'Broadcast',
          body: 'Message to all',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        successCount: 3,
        failureCount: 0,
      };

      mockProvider.sendMulticast.mockResolvedValue(response);

      const result = await connector.sendMulticast(request);

      expect(mockProvider.sendMulticast).toHaveBeenCalledWith(request);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
    });

    it('handles partial multicast failures', async () => {
      const request: SendNotificationRequest = {
        target: {
          tokens: ['token-1', 'invalid-token', 'token-3'],
        },
        notification: {
          title: 'Broadcast',
          body: 'Message',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        successCount: 2,
        failureCount: 1,
        errors: [
          {
            token: 'invalid-token',
            error: 'Invalid token',
          },
        ],
      };

      mockProvider.sendMulticast.mockResolvedValue(response);

      const result = await connector.sendMulticast(request);

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('throws error when no tokens provided', async () => {
      const request: SendNotificationRequest = {
        target: {
          tokens: [],
        },
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      await expect(connector.sendMulticast(request)).rejects.toThrow(
        'Multicast requires at least one device token'
      );
    });

    it('throws error when tokens undefined', async () => {
      const request: SendNotificationRequest = {
        target: {},
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      await expect(connector.sendMulticast(request)).rejects.toThrow(
        'Multicast requires at least one device token'
      );
    });

    it('logs multicast operation', async () => {
      const request: SendNotificationRequest = {
        target: {
          tokens: ['token-1', 'token-2'],
        },
        notification: {
          title: 'Broadcast',
          body: 'Message',
        },
      };

      const response: SendNotificationResponse = {
        success: true,
        successCount: 2,
        failureCount: 0,
      };

      mockProvider.sendMulticast.mockResolvedValue(response);

      await connector.sendMulticast(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Sending multicast push notification',
        expect.objectContaining({
          tokenCount: 2,
          title: 'Broadcast',
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Multicast notification sent',
        expect.objectContaining({
          successCount: 2,
          failureCount: 0,
        })
      );
    });

    it('handles multicast provider errors', async () => {
      const request: SendNotificationRequest = {
        target: {
          tokens: ['token-1', 'token-2'],
        },
        notification: {
          title: 'Test',
          body: 'Message',
        },
      };

      mockProvider.sendMulticast.mockRejectedValue(new Error('Service unavailable'));

      await expect(connector.sendMulticast(request)).rejects.toThrow('Service unavailable');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('subscribeToTopic', () => {
    it('subscribes tokens to topic successfully', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'token-2', 'token-3'],
        topic: 'sports',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 3,
        failureCount: 0,
      };

      mockProvider.subscribeToTopic.mockResolvedValue(response);

      const result = await connector.subscribeToTopic(request);

      expect(mockProvider.subscribeToTopic).toHaveBeenCalledWith(request);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
    });

    it('handles partial subscription failures', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'invalid-token', 'token-3'],
        topic: 'news',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 2,
        failureCount: 1,
        errors: [
          {
            token: 'invalid-token',
            error: 'Invalid token',
          },
        ],
      };

      mockProvider.subscribeToTopic.mockResolvedValue(response);

      const result = await connector.subscribeToTopic(request);

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('logs topic subscription operation', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'token-2'],
        topic: 'weather',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 2,
        failureCount: 0,
      };

      mockProvider.subscribeToTopic.mockResolvedValue(response);

      await connector.subscribeToTopic(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Subscribing tokens to topic',
        expect.objectContaining({
          topic: 'weather',
          tokenCount: 2,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Topic subscription completed',
        expect.objectContaining({
          topic: 'weather',
          successCount: 2,
          failureCount: 0,
        })
      );
    });

    it('handles subscription errors', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1'],
        topic: 'sports',
      };

      mockProvider.subscribeToTopic.mockRejectedValue(new Error('Topic not found'));

      await expect(connector.subscribeToTopic(request)).rejects.toThrow('Topic not found');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to subscribe to topic',
        expect.any(Error),
        expect.objectContaining({
          topic: 'sports',
        })
      );
    });
  });

  describe('unsubscribeFromTopic', () => {
    it('unsubscribes tokens from topic successfully', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'token-2'],
        topic: 'promotions',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 2,
        failureCount: 0,
      };

      mockProvider.unsubscribeFromTopic.mockResolvedValue(response);

      const result = await connector.unsubscribeFromTopic(request);

      expect(mockProvider.unsubscribeFromTopic).toHaveBeenCalledWith(request);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('handles partial unsubscription failures', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'invalid-token'],
        topic: 'promotions',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 1,
        failureCount: 1,
        errors: [
          {
            token: 'invalid-token',
            error: 'Token not subscribed',
          },
        ],
      };

      mockProvider.unsubscribeFromTopic.mockResolvedValue(response);

      const result = await connector.unsubscribeFromTopic(request);

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
    });

    it('logs topic unsubscription operation', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1', 'token-2', 'token-3'],
        topic: 'updates',
      };

      const response: TopicSubscriptionResponse = {
        successCount: 3,
        failureCount: 0,
      };

      mockProvider.unsubscribeFromTopic.mockResolvedValue(response);

      await connector.unsubscribeFromTopic(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Unsubscribing tokens from topic',
        expect.objectContaining({
          topic: 'updates',
          tokenCount: 3,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Topic unsubscription completed',
        expect.objectContaining({
          topic: 'updates',
          successCount: 3,
          failureCount: 0,
        })
      );
    });

    it('handles unsubscription errors', async () => {
      const request: TopicSubscriptionRequest = {
        tokens: ['token-1'],
        topic: 'nonexistent',
      };

      mockProvider.unsubscribeFromTopic.mockRejectedValue(new Error('Topic does not exist'));

      await expect(connector.unsubscribeFromTopic(request)).rejects.toThrow('Topic does not exist');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to unsubscribe from topic',
        expect.any(Error),
        expect.objectContaining({
          topic: 'nonexistent',
        })
      );
    });
  });

  describe('validateToken', () => {
    it('validates a valid device token', async () => {
      mockProvider.validateToken.mockResolvedValue(true);

      const isValid = await connector.validateToken('valid-token-123');

      expect(mockProvider.validateToken).toHaveBeenCalledWith('valid-token-123');
      expect(isValid).toBe(true);
    });

    it('invalidates an invalid device token', async () => {
      mockProvider.validateToken.mockResolvedValue(false);

      const isValid = await connector.validateToken('invalid-token');

      expect(isValid).toBe(false);
    });

    it('returns false when validation fails with error', async () => {
      mockProvider.validateToken.mockRejectedValue(new Error('Validation service unavailable'));

      const isValid = await connector.validateToken('token-123');

      expect(isValid).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to validate token',
        expect.any(Error)
      );
    });

    it('returns false for non-Error exceptions', async () => {
      mockProvider.validateToken.mockRejectedValue('Unknown error');

      const isValid = await connector.validateToken('token-123');

      expect(isValid).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
