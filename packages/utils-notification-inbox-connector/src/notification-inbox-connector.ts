/**
 * Notification Inbox Connector
 *
 * Manages persistent notification records for pull (REST) and
 * push (database-native realtime, e.g. Firestore onSnapshot) delivery.
 * Serverless-compatible — no long-lived connections required.
 */

import {
  WriteNotificationRequest,
  WriteNotificationResponse,
  NotificationFilter,
  NotificationQueryResult,
  MarkReadResult,
  DeleteResult,
  UnreadCountResult,
} from './types';

/**
 * Notification Inbox Provider Interface
 * Abstracts the storage backend for notification records.
 */
export interface NotificationInboxProvider {
  /** Persist a new notification record */
  writeNotification(request: WriteNotificationRequest): Promise<WriteNotificationResponse>;

  /** Query notifications for a user with filters */
  getNotifications(userId: string, filters?: NotificationFilter): Promise<NotificationQueryResult>;

  /** Mark a single notification as read */
  markAsRead(notificationId: string): Promise<MarkReadResult>;

  /** Mark multiple notifications as read */
  markMultipleAsRead(notificationIds: string[]): Promise<MarkReadResult>;

  /** Mark all notifications as read for a user */
  markAllAsRead(userId: string): Promise<MarkReadResult>;

  /** Delete a single notification */
  deleteNotification(notificationId: string): Promise<DeleteResult>;

  /** Delete all expired notifications (expiresAt < now) */
  deleteExpired(): Promise<DeleteResult>;

  /** Get unread notification count for a user */
  getUnreadCount(userId: string): Promise<UnreadCountResult>;
}

/**
 * Notification Inbox Connector
 * Facade over the provider with logging and error handling.
 */
export class NotificationInboxConnector {
  private provider: NotificationInboxProvider;
  private log: any;

  constructor(provider: NotificationInboxProvider, logger?: any) {
    this.provider = provider;
    this.log = logger || console;
  }

  async writeNotification(request: WriteNotificationRequest): Promise<WriteNotificationResponse> {
    this.log.info?.('Writing inbox notification', {
      userId: request.userId,
      type: request.type,
      title: request.title,
    });

    try {
      const response = await this.provider.writeNotification(request);

      if (response.success) {
        this.log.info?.('Inbox notification written', {
          notificationId: response.notificationId,
          userId: request.userId,
        });
      } else {
        this.log.warn?.('Failed to write inbox notification', {
          error: response.error,
          userId: request.userId,
        });
      }

      return response;
    } catch (error) {
      this.log.error?.(
        'Error writing inbox notification',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async getNotifications(userId: string, filters?: NotificationFilter): Promise<NotificationQueryResult> {
    this.log.debug?.('Querying inbox notifications', { userId, filters });

    try {
      return await this.provider.getNotifications(userId, filters);
    } catch (error) {
      this.log.error?.(
        'Error querying inbox notifications',
        error instanceof Error ? error : new Error(String(error)),
        { userId },
      );
      throw error;
    }
  }

  async markAsRead(notificationId: string): Promise<MarkReadResult> {
    this.log.debug?.('Marking notification as read', { notificationId });
    try {
      return await this.provider.markAsRead(notificationId);
    } catch (error) {
      this.log.error?.(
        'Error marking notification as read',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async markMultipleAsRead(notificationIds: string[]): Promise<MarkReadResult> {
    this.log.debug?.('Marking multiple notifications as read', { count: notificationIds.length });
    try {
      return await this.provider.markMultipleAsRead(notificationIds);
    } catch (error) {
      this.log.error?.(
        'Error marking multiple notifications as read',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async markAllAsRead(userId: string): Promise<MarkReadResult> {
    this.log.info?.('Marking all notifications as read', { userId });
    try {
      return await this.provider.markAllAsRead(userId);
    } catch (error) {
      this.log.error?.(
        'Error marking all notifications as read',
        error instanceof Error ? error : new Error(String(error)),
        { userId },
      );
      throw error;
    }
  }

  async deleteNotification(notificationId: string): Promise<DeleteResult> {
    this.log.info?.('Deleting notification', { notificationId });
    try {
      return await this.provider.deleteNotification(notificationId);
    } catch (error) {
      this.log.error?.(
        'Error deleting notification',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async deleteExpired(): Promise<DeleteResult> {
    this.log.info?.('Deleting expired notifications');
    try {
      const result = await this.provider.deleteExpired();
      this.log.info?.('Expired notification cleanup complete', {
        deletedCount: result.deletedCount,
      });
      return result;
    } catch (error) {
      this.log.error?.(
        'Error deleting expired notifications',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async getUnreadCount(userId: string): Promise<UnreadCountResult> {
    try {
      return await this.provider.getUnreadCount(userId);
    } catch (error) {
      this.log.error?.(
        'Error getting unread count',
        error instanceof Error ? error : new Error(String(error)),
        { userId },
      );
      throw error;
    }
  }
}
