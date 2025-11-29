/**
 * Push Notifications Types
 */

/**
 * Push notification message structure
 */
export interface PushNotificationMessage {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  clickAction?: string;
}

/**
 * Notification target options
 */
export interface NotificationTarget {
  token?: string;
  tokens?: string[];
  topic?: string;
  condition?: string;
}

/**
 * Notification options
 */
export interface NotificationOptions {
  priority?: 'high' | 'normal';
  ttl?: number; // Time to live in seconds
  collapseKey?: string;
  mutableContent?: boolean;
  contentAvailable?: boolean;
}

/**
 * Send notification request
 */
export interface SendNotificationRequest {
  target: NotificationTarget;
  notification: PushNotificationMessage;
  options?: NotificationOptions;
}

/**
 * Send notification response
 */
export interface SendNotificationResponse {
  success: boolean;
  messageId?: string;
  failureCount?: number;
  successCount?: number;
  errors?: Array<{
    token?: string;
    error: string;
  }>;
}

/**
 * Topic subscription request
 */
export interface TopicSubscriptionRequest {
  tokens: string[];
  topic: string;
}

/**
 * Topic subscription response
 */
export interface TopicSubscriptionResponse {
  successCount: number;
  failureCount: number;
  errors?: Array<{
    token: string;
    error: string;
  }>;
}
