/**
 * AWS SNS Provider
 * Implementation using AWS SDK
 */

import { SNS } from 'aws-sdk';
import { SNSProvider } from '../sns-connector';
import {
  DomainEvent,
  SNSResult,
  BatchSNSResult,
  TopicOptions,
  TopicInfo,
  SubscriptionInfo,
  SNSProtocol,
  PublishOptions,
} from '../types';

export interface AWSSNSConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class AWSSNSProvider implements SNSProvider {
  private client: SNS;

  constructor(config: AWSSNSConfig) {
    this.client = new SNS({
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
  }

  /**
   * Publish event to SNS topic
   */
  async publishEvent(topicArn: string, event: DomainEvent, options?: PublishOptions): Promise<SNSResult> {
    try {
      const message = JSON.stringify({
        ...event,
        metadata: {
          ...event.metadata,
          timestamp: event.metadata.timestamp.toISOString(),
        },
      });

      const params: SNS.PublishInput = {
        TopicArn: topicArn,
        Message: message,
        Subject: options?.subject || `${event.eventType} Event`,
        MessageAttributes: this.formatMessageAttributes(event, options),
      };

      if (options?.messageDeduplicationId) {
        params.MessageDeduplicationId = options.messageDeduplicationId;
      }

      if (options?.messageGroupId) {
        params.MessageGroupId = options.messageGroupId;
      }

      const result = await this.client.publish(params).promise();

      return {
        success: true,
        messageId: result.MessageId,
        sequenceNumber: result.SequenceNumber,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: (error as any).code || 'AWS_SNS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Publish multiple events in batch
   * Note: SNS doesn't have native batch publish, so we publish sequentially
   */
  async publishBatch(topicArn: string, events: DomainEvent[]): Promise<BatchSNSResult> {
    const successful: Array<{ messageId: string; index: number }> = [];
    const failed: Array<{ index: number; error: any }> = [];

    await Promise.all(
      events.map(async (event, index) => {
        const result = await this.publishEvent(topicArn, event);

        if (result.success && result.messageId) {
          successful.push({ messageId: result.messageId, index });
        } else {
          failed.push({ index, error: result.error });
        }
      })
    );

    return {
      success: failed.length === 0,
      successful,
      failed,
      timestamp: new Date(),
    };
  }

  /**
   * Create SNS topic
   */
  async createTopic(name: string, options?: TopicOptions): Promise<TopicInfo> {
    const params: SNS.CreateTopicInput = {
      Name: name,
      Attributes: {},
      Tags: options?.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
    };

    if (options?.displayName) {
      params.Attributes!.DisplayName = options.displayName;
    }

    if (options?.deliveryPolicy) {
      params.Attributes!.DeliveryPolicy = JSON.stringify(options.deliveryPolicy);
    }

    if (options?.policy) {
      params.Attributes!.Policy = options.policy;
    }

    if (options?.kmsMasterKeyId) {
      params.Attributes!.KmsMasterKeyId = options.kmsMasterKeyId;
    }

    const result = await this.client.createTopic(params).promise();
    const topicArn = result.TopicArn!;

    return this.getTopicAttributes(topicArn);
  }

  /**
   * Delete SNS topic
   */
  async deleteTopic(topicArn: string): Promise<void> {
    await this.client.deleteTopic({ TopicArn: topicArn }).promise();
  }

  /**
   * Subscribe to SNS topic
   */
  async subscribeTopic(
    topicArn: string,
    endpoint: string,
    protocol: SNSProtocol
  ): Promise<SubscriptionInfo> {
    const result = await this.client
      .subscribe({
        TopicArn: topicArn,
        Protocol: protocol,
        Endpoint: endpoint,
      })
      .promise();

    return {
      subscriptionArn: result.SubscriptionArn!,
      topicArn,
      protocol,
      endpoint,
      owner: '', // AWS doesn't return this directly
    };
  }

  /**
   * Unsubscribe from SNS topic
   */
  async unsubscribe(subscriptionArn: string): Promise<void> {
    await this.client.unsubscribe({ SubscriptionArn: subscriptionArn }).promise();
  }

  /**
   * List all topics
   */
  async listTopics(): Promise<string[]> {
    const result = await this.client.listTopics().promise();
    return result.Topics?.map((topic) => topic.TopicArn!) || [];
  }

  /**
   * Get topic attributes
   */
  async getTopicAttributes(topicArn: string): Promise<TopicInfo> {
    const result = await this.client.getTopicAttributes({ TopicArn: topicArn }).promise();
    const attrs = result.Attributes || {};

    return {
      topicArn,
      displayName: attrs.DisplayName,
      subscriptionsConfirmed: parseInt(attrs.SubscriptionsConfirmed || '0', 10),
      subscriptionsPending: parseInt(attrs.SubscriptionsPending || '0', 10),
      subscriptionsDeleted: parseInt(attrs.SubscriptionsDeleted || '0', 10),
    };
  }

  /**
   * Format message attributes for SNS
   */
  private formatMessageAttributes(
    event: DomainEvent,
    options?: PublishOptions
  ): SNS.MessageAttributeMap {
    const attributes: SNS.MessageAttributeMap = {
      eventType: {
        DataType: 'String',
        StringValue: event.eventType,
      },
      entityType: {
        DataType: 'String',
        StringValue: event.entityType,
      },
      correlationId: {
        DataType: 'String',
        StringValue: event.metadata.correlationId,
      },
      source: {
        DataType: 'String',
        StringValue: event.metadata.source,
      },
    };

    if (event.metadata.userId) {
      attributes.userId = {
        DataType: 'String',
        StringValue: event.metadata.userId,
      };
    }

    // Add custom attributes from options
    if (options?.messageAttributes) {
      for (const [key, attr] of Object.entries(options.messageAttributes)) {
        attributes[key] = {
          DataType: attr.dataType,
          StringValue: attr.stringValue,
          BinaryValue: attr.binaryValue,
        };
      }
    }

    return attributes;
  }
}
