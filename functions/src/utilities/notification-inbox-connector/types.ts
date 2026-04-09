/**
 * Notification Inbox Types
 *
 * Persistent notification records that support both REST pull
 * and database-native realtime delivery (e.g. Firestore onSnapshot).
 */

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * The stored notification record
 */
export interface InboxNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: NotificationPriority;
  read: boolean;
  readAt?: Date | null;
  createdAt: Date;
  expiresAt?: Date | null;
  sourceEvent?: string;
  actionUrl?: string;
  imageUrl?: string;
  groupKey?: string;
}

/**
 * Input for writing a new notification
 */
export interface WriteNotificationRequest {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: NotificationPriority;
  sourceEvent?: string;
  actionUrl?: string;
  imageUrl?: string;
  groupKey?: string;
  /** Override TTL for this specific notification (seconds) */
  ttlSeconds?: number;
}

/**
 * Response from writing a notification
 */
export interface WriteNotificationResponse {
  success: boolean;
  notificationId?: string;
  error?: string;
}

/**
 * Filter options for querying notifications
 */
export interface NotificationFilter {
  read?: boolean;
  type?: string;
  types?: string[];
  priority?: NotificationPriority;
  since?: Date;
  before?: Date;
  groupKey?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'priority';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for notification queries
 */
export interface NotificationQueryResult {
  notifications: InboxNotification[];
  total: number;
  hasMore: boolean;
}

/**
 * Result of mark-as-read operations
 */
export interface MarkReadResult {
  success: boolean;
  modifiedCount: number;
  error?: string;
}

/**
 * Result of delete/cleanup operations
 */
export interface DeleteResult {
  success: boolean;
  deletedCount: number;
  error?: string;
}

/**
 * Unread count response
 */
export interface UnreadCountResult {
  count: number;
  byType?: Record<string, number>;
}
