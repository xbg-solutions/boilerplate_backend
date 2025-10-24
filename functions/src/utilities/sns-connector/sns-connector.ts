/**
 * SNS Connector
 * Streams domain events to external systems via AWS SNS
 */

import {
  DomainEvent,
  SNSResult,
  BatchSNSResult,
  TopicOptions,
  TopicInfo,
  SubscriptionInfo,
  SNSProtocol,
  PublishOptions,
} from './types';
import { logger } from '../logger';

export interface SNSProvider {
  publishEvent(topicArn: string, event: DomainEvent, options?: PublishOptions): Promise<SNSResult>;
  publishBatch(topicArn: string, events: DomainEvent[]): Promise<BatchSNSResult>;
  createTopic(name: string, options?: TopicOptions): Promise<TopicInfo>;
  deleteTopic(topicArn: string): Promise<void>;
  subscribeTopic(topicArn: string, endpoint: string, protocol: SNSProtocol): Promise<SubscriptionInfo>;
  unsubscribe(subscriptionArn: string): Promise<void>;
  listTopics(): Promise<string[]>;
  getTopicAttributes(topicArn: string): Promise<TopicInfo>;
}

export class SNSConnector {
  private provider: SNSProvider;

  constructor(provider: SNSProvider) {
    this.provider = provider;
  }

  /**
   * Publish a domain event to SNS topic
   */
  async publishEvent(topic: string, event: DomainEvent, options?: PublishOptions): Promise<SNSResult> {
    try {
      logger.info('Publishing event to SNS', {
        topic,
        eventType: event.eventType,
        entityId: event.entityId,
        correlationId: event.metadata.correlationId,
      });

      const result = await this.provider.publishEvent(topic, event, options);

      if (result.success) {
        logger.info('Event published successfully', {
          topic,
          messageId: result.messageId,
          eventType: event.eventType,
        });
      } else {
        logger.error('Failed to publish event', {
          topic,
          eventType: event.eventType,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      logger.error('SNS publish error', {
        topic,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          code: 'PUBLISH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Publish multiple events in batch
   */
  async publishBatch(topic: string, events: DomainEvent[]): Promise<BatchSNSResult> {
    try {
      logger.info('Publishing batch to SNS', {
        topic,
        eventCount: events.length,
      });

      const result = await this.provider.publishBatch(topic, events);

      logger.info('Batch publish complete', {
        topic,
        successful: result.successful.length,
        failed: result.failed.length,
      });

      return result;
    } catch (error) {
      logger.error('SNS batch publish error', {
        topic,
        eventCount: events.length,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        successful: [],
        failed: events.map((_, index) => ({
          index,
          error: {
            code: 'BATCH_PUBLISH_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        })),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Create a new SNS topic
   */
  async createTopic(name: string, options?: TopicOptions): Promise<TopicInfo> {
    logger.info('Creating SNS topic', { name });
    return this.provider.createTopic(name, options);
  }

  /**
   * Delete an SNS topic
   */
  async deleteTopic(topicArn: string): Promise<void> {
    logger.info('Deleting SNS topic', { topicArn });
    return this.provider.deleteTopic(topicArn);
  }

  /**
   * Subscribe to an SNS topic
   */
  async subscribeTopic(
    topicArn: string,
    endpoint: string,
    protocol: SNSProtocol
  ): Promise<SubscriptionInfo> {
    logger.info('Subscribing to SNS topic', { topicArn, endpoint, protocol });
    return this.provider.subscribeTopic(topicArn, endpoint, protocol);
  }

  /**
   * Unsubscribe from an SNS topic
   */
  async unsubscribe(subscriptionArn: string): Promise<void> {
    logger.info('Unsubscribing from SNS topic', { subscriptionArn });
    return this.provider.unsubscribe(subscriptionArn);
  }

  /**
   * List all SNS topics
   */
  async listTopics(): Promise<string[]> {
    return this.provider.listTopics();
  }

  /**
   * Get topic attributes
   */
  async getTopicAttributes(topicArn: string): Promise<TopicInfo> {
    return this.provider.getTopicAttributes(topicArn);
  }
}
