/**
 * Push Notifications Connector
 */

import {
  SendNotificationRequest,
  SendNotificationResponse,
  TopicSubscriptionRequest,
  TopicSubscriptionResponse,
} from './types';
import { logger } from '../logger';

/**
 * Push Notifications Provider Interface
 */
export interface PushNotificationsProvider {
  /**
   * Send push notification
   */
  send(request: SendNotificationRequest): Promise<SendNotificationResponse>;

  /**
   * Send notification to multiple devices
   */
  sendMulticast(request: SendNotificationRequest): Promise<SendNotificationResponse>;

  /**
   * Subscribe tokens to a topic
   */
  subscribeToTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse>;

  /**
   * Unsubscribe tokens from a topic
   */
  unsubscribeFromTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse>;

  /**
   * Validate device token
   */
  validateToken(token: string): Promise<boolean>;
}

/**
 * Push Notifications Connector
 * Provides unified interface for sending push notifications
 */
export class PushNotificationsConnector {
  private provider: PushNotificationsProvider;

  constructor(provider: PushNotificationsProvider) {
    this.provider = provider;
  }

  /**
   * Send push notification to single device, topic, or condition
   */
  async send(request: SendNotificationRequest): Promise<SendNotificationResponse> {
    logger.info('Sending push notification', {
      target: request.target,
      title: request.notification.title,
    });

    try {
      const response = await this.provider.send(request);

      if (response.success) {
        logger.info('Push notification sent successfully', {
          messageId: response.messageId,
        });
      } else {
        logger.warn('Push notification failed', {
          errors: response.errors,
        });
      }

      return response;
    } catch (error) {
      logger.error('Failed to send push notification', error instanceof Error ? error : new Error('Unknown error'));
      throw error;
    }
  }

  /**
   * Send push notification to multiple devices
   */
  async sendMulticast(request: SendNotificationRequest): Promise<SendNotificationResponse> {
    if (!request.target.tokens || request.target.tokens.length === 0) {
      throw new Error('Multicast requires at least one device token');
    }

    logger.info('Sending multicast push notification', {
      tokenCount: request.target.tokens.length,
      title: request.notification.title,
    });

    try {
      const response = await this.provider.sendMulticast(request);

      logger.info('Multicast notification sent', {
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return response;
    } catch (error) {
      logger.error('Failed to send multicast notification', error instanceof Error ? error : new Error('Unknown error'));
      throw error;
    }
  }

  /**
   * Subscribe device tokens to a topic
   */
  async subscribeToTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse> {
    logger.info('Subscribing tokens to topic', {
      topic: request.topic,
      tokenCount: request.tokens.length,
    });

    try {
      const response = await this.provider.subscribeToTopic(request);

      logger.info('Topic subscription completed', {
        topic: request.topic,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return response;
    } catch (error) {
      logger.error('Failed to subscribe to topic', error instanceof Error ? error : new Error('Unknown error'), {
        topic: request.topic,
      });
      throw error;
    }
  }

  /**
   * Unsubscribe device tokens from a topic
   */
  async unsubscribeFromTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse> {
    logger.info('Unsubscribing tokens from topic', {
      topic: request.topic,
      tokenCount: request.tokens.length,
    });

    try {
      const response = await this.provider.unsubscribeFromTopic(request);

      logger.info('Topic unsubscription completed', {
        topic: request.topic,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return response;
    } catch (error) {
      logger.error('Failed to unsubscribe from topic', error instanceof Error ? error : new Error('Unknown error'), {
        topic: request.topic,
      });
      throw error;
    }
  }

  /**
   * Validate if a device token is valid
   */
  async validateToken(token: string): Promise<boolean> {
    try {
      return await this.provider.validateToken(token);
    } catch (error) {
      logger.error('Failed to validate token', error instanceof Error ? error : new Error('Unknown error'));
      return false;
    }
  }
}
