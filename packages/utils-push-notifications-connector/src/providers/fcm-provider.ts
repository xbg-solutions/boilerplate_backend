/**
 * Firebase Cloud Messaging (FCM) Provider
 */

import * as admin from 'firebase-admin';
import { PushNotificationsProvider } from '../push-notifications-connector';
import {
  SendNotificationRequest,
  SendNotificationResponse,
  TopicSubscriptionRequest,
  TopicSubscriptionResponse,
} from '../types';

export interface FCMProviderConfig {
  // FCM uses Firebase Admin SDK which is initialized globally
  // No specific config needed here, but we keep the interface for consistency
}

export class FCMProvider implements PushNotificationsProvider {
  private messaging: admin.messaging.Messaging;

  constructor(config?: FCMProviderConfig) {
    this.messaging = admin.messaging();
  }

  /**
   * Send notification to single target (token, topic, or condition)
   */
  async send(request: SendNotificationRequest): Promise<SendNotificationResponse> {
    try {
      const message = this.buildMessage(request);

      const messageId = await this.messaging.send(message);

      return {
        success: true,
        messageId,
        successCount: 1,
        failureCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failureCount: 1,
        errors: [{
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Send notification to multiple devices
   */
  async sendMulticast(request: SendNotificationRequest): Promise<SendNotificationResponse> {
    if (!request.target.tokens || request.target.tokens.length === 0) {
      return {
        success: false,
        successCount: 0,
        failureCount: 0,
        errors: [{ error: 'No tokens provided' }],
      };
    }

    try {
      const message = this.buildMulticastMessage(request);

      const response = await this.messaging.sendEachForMulticast(message);

      const errors = response.responses
        .map((resp, idx) => ({
          token: request.target.tokens![idx],
          error: resp.error?.message || '',
        }))
        .filter(item => item.error);

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failureCount: request.target.tokens.length,
        errors: [{
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse> {
    try {
      const response = await this.messaging.subscribeToTopic(
        request.tokens,
        request.topic
      );

      const errors = response.errors.map((error, idx) => ({
        token: request.tokens[idx],
        error: error.error.message,
      }));

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        successCount: 0,
        failureCount: request.tokens.length,
        errors: [{
          token: '',
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(request: TopicSubscriptionRequest): Promise<TopicSubscriptionResponse> {
    try {
      const response = await this.messaging.unsubscribeFromTopic(
        request.tokens,
        request.topic
      );

      const errors = response.errors.map((error, idx) => ({
        token: request.tokens[idx],
        error: error.error.message,
      }));

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        successCount: 0,
        failureCount: request.tokens.length,
        errors: [{
          token: '',
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Validate device token by attempting a dry run send
   */
  async validateToken(token: string): Promise<boolean> {
    try {
      // FCM doesn't have a direct validation method
      // We can try a dry run send to check token validity
      await this.messaging.send({
        token,
        notification: {
          title: 'Test',
          body: 'Validation test',
        },
      }, true); // dry run

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Build FCM message for single target
   */
  private buildMessage(request: SendNotificationRequest): admin.messaging.Message {
    const basePayload = {
      notification: {
        title: request.notification.title,
        body: request.notification.body,
        imageUrl: request.notification.imageUrl,
      },
      data: request.notification.data,
    };

    // Build message with proper type based on target
    let message: admin.messaging.Message;
    if (request.target.token) {
      message = {
        ...basePayload,
        token: request.target.token,
      };
    } else if (request.target.topic) {
      message = {
        ...basePayload,
        topic: request.target.topic,
      };
    } else if (request.target.condition) {
      message = {
        ...basePayload,
        condition: request.target.condition,
      };
    } else {
      throw new Error('Message must have either token, topic, or condition');
    }

    // Add Android-specific options
    if (request.options) {
      message.android = {
        priority: request.options.priority === 'high' ? 'high' : 'normal',
        ttl: request.options.ttl ? request.options.ttl * 1000 : undefined,
        collapseKey: request.options.collapseKey,
      };

      // Add iOS-specific options
      message.apns = {
        payload: {
          aps: {
            badge: request.notification.badge,
            sound: request.notification.sound || 'default',
            contentAvailable: request.options.contentAvailable,
            mutableContent: request.options.mutableContent,
          },
        },
      };
    }

    // Add web push options
    if (request.notification.clickAction) {
      message.webpush = {
        fcmOptions: {
          link: request.notification.clickAction,
        },
      };
    }

    return message;
  }

  /**
   * Build FCM multicast message
   */
  private buildMulticastMessage(request: SendNotificationRequest): admin.messaging.MulticastMessage {
    const baseMessage = this.buildMessage(request);

    return {
      ...baseMessage,
      tokens: request.target.tokens!,
    };
  }
}
