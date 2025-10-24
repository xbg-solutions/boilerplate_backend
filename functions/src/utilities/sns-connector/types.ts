/**
 * SNS Connector Types
 * Type definitions for AWS SNS integration
 */

export interface DomainEvent {
  eventType: string;
  entityType: string;
  entityId: string;
  data: Record<string, any>;
  metadata: EventMetadata;
}

export interface EventMetadata {
  timestamp: Date;
  correlationId: string;
  userId?: string;
  source: string;
  version: string;
}

export interface SNSResult {
  success: boolean;
  messageId?: string;
  sequenceNumber?: string;
  error?: SNSError;
  timestamp: Date;
}

export interface BatchSNSResult {
  success: boolean;
  successful: Array<{ messageId: string; index: number }>;
  failed: Array<{ index: number; error: SNSError }>;
  timestamp: Date;
}

export interface SNSError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface TopicOptions {
  displayName?: string;
  deliveryPolicy?: Record<string, any>;
  policy?: string;
  kmsMasterKeyId?: string;
  tags?: Record<string, string>;
}

export interface TopicInfo {
  topicArn: string;
  displayName?: string;
  subscriptionsConfirmed: number;
  subscriptionsPending: number;
  subscriptionsDeleted: number;
}

export interface SubscriptionInfo {
  subscriptionArn: string;
  topicArn: string;
  protocol: SNSProtocol;
  endpoint: string;
  owner: string;
}

export type SNSProtocol = 'http' | 'https' | 'email' | 'email-json' | 'sms' | 'sqs' | 'application' | 'lambda';

export interface PublishOptions {
  subject?: string;
  messageAttributes?: Record<string, MessageAttribute>;
  messageStructure?: 'json';
  messageDeduplicationId?: string;
  messageGroupId?: string;
}

export interface MessageAttribute {
  dataType: 'String' | 'Number' | 'Binary';
  stringValue?: string;
  binaryValue?: Buffer;
}
