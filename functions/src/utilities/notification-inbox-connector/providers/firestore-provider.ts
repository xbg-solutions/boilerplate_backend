/**
 * Firestore Notification Inbox Provider
 *
 * Stores notification records in a Firestore collection. Clients get
 * realtime delivery via Firestore onSnapshot — no server-side SSE/WebSocket needed.
 */

import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { NotificationInboxProvider } from '../notification-inbox-connector';
import {
  WriteNotificationRequest,
  WriteNotificationResponse,
  NotificationFilter,
  NotificationQueryResult,
  MarkReadResult,
  DeleteResult,
  UnreadCountResult,
  InboxNotification,
} from '../types';
import { NotificationInboxRetentionConfig } from '../../../config/communications.config';

export interface FirestoreInboxProviderConfig {
  collection: string;
  retention: NotificationInboxRetentionConfig;
  databaseId?: string;
}

const BATCH_LIMIT = 500;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;

export class FirestoreInboxProvider implements NotificationInboxProvider {
  private db: FirebaseFirestore.Firestore;
  private collectionName: string;
  private retention: NotificationInboxRetentionConfig;

  constructor(config: FirestoreInboxProviderConfig) {
    this.db = config.databaseId
      ? getFirestore(admin.app(), config.databaseId)
      : getFirestore();
    this.collectionName = config.collection;
    this.retention = config.retention;
  }

  private get collection(): FirebaseFirestore.CollectionReference {
    return this.db.collection(this.collectionName);
  }

  async writeNotification(request: WriteNotificationRequest): Promise<WriteNotificationResponse> {
    try {
      const now = new Date();
      const expiresAt = this.computeExpiresAt(request.type, request.ttlSeconds, now);

      const docRef = this.collection.doc();
      const record: Omit<InboxNotification, 'id'> = {
        userId: request.userId,
        type: request.type,
        title: request.title,
        body: request.body,
        data: request.data ?? undefined,
        priority: request.priority ?? 'normal',
        read: false,
        readAt: null,
        createdAt: now,
        expiresAt,
        sourceEvent: request.sourceEvent ?? undefined,
        actionUrl: request.actionUrl ?? undefined,
        imageUrl: request.imageUrl ?? undefined,
        groupKey: request.groupKey ?? undefined,
      };

      await docRef.set(this.toFirestore(record));

      return { success: true, notificationId: docRef.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getNotifications(userId: string, filters?: NotificationFilter): Promise<NotificationQueryResult> {
    let query: FirebaseFirestore.Query = this.collection
      .where('userId', '==', userId);

    if (filters?.read !== undefined) {
      query = query.where('read', '==', filters.read);
    }

    if (filters?.type) {
      query = query.where('type', '==', filters.type);
    } else if (filters?.types && filters.types.length > 0) {
      query = query.where('type', 'in', filters.types);
    }

    if (filters?.priority) {
      query = query.where('priority', '==', filters.priority);
    }

    if (filters?.groupKey) {
      query = query.where('groupKey', '==', filters.groupKey);
    }

    if (filters?.since) {
      query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(filters.since));
    }

    if (filters?.before) {
      query = query.where('createdAt', '<', admin.firestore.Timestamp.fromDate(filters.before));
    }

    // Order
    const orderField = filters?.orderBy ?? 'createdAt';
    const orderDir = filters?.orderDirection ?? 'desc';
    query = query.orderBy(orderField, orderDir);

    // Count total (before pagination)
    const countSnapshot = await query.count().get();
    const total = countSnapshot.data().count;

    // Pagination
    const limit = Math.min(filters?.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const offset = filters?.offset ?? 0;

    if (offset > 0) {
      query = query.offset(offset);
    }
    query = query.limit(limit);

    const snapshot = await query.get();
    const notifications = snapshot.docs.map((doc) => this.fromFirestore(doc));

    return {
      notifications,
      total,
      hasMore: offset + notifications.length < total,
    };
  }

  async markAsRead(notificationId: string): Promise<MarkReadResult> {
    try {
      const docRef = this.collection.doc(notificationId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { success: false, modifiedCount: 0, error: 'Notification not found' };
      }

      await docRef.update({
        read: true,
        readAt: admin.firestore.Timestamp.now(),
      });

      return { success: true, modifiedCount: 1 };
    } catch (error) {
      return {
        success: false,
        modifiedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async markMultipleAsRead(notificationIds: string[]): Promise<MarkReadResult> {
    if (notificationIds.length === 0) {
      return { success: true, modifiedCount: 0 };
    }

    try {
      let modifiedCount = 0;

      // Process in batches of BATCH_LIMIT
      for (let i = 0; i < notificationIds.length; i += BATCH_LIMIT) {
        const batchIds = notificationIds.slice(i, i + BATCH_LIMIT);
        const batch = this.db.batch();

        for (const id of batchIds) {
          const docRef = this.collection.doc(id);
          batch.update(docRef, {
            read: true,
            readAt: admin.firestore.Timestamp.now(),
          });
        }

        await batch.commit();
        modifiedCount += batchIds.length;
      }

      return { success: true, modifiedCount };
    } catch (error) {
      return {
        success: false,
        modifiedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async markAllAsRead(userId: string): Promise<MarkReadResult> {
    try {
      let modifiedCount = 0;
      let hasMore = true;

      while (hasMore) {
        const snapshot = await this.collection
          .where('userId', '==', userId)
          .where('read', '==', false)
          .limit(BATCH_LIMIT)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = this.db.batch();
        for (const doc of snapshot.docs) {
          batch.update(doc.ref, {
            read: true,
            readAt: admin.firestore.Timestamp.now(),
          });
        }

        await batch.commit();
        modifiedCount += snapshot.size;

        if (snapshot.size < BATCH_LIMIT) {
          hasMore = false;
        }
      }

      return { success: true, modifiedCount };
    } catch (error) {
      return {
        success: false,
        modifiedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteNotification(notificationId: string): Promise<DeleteResult> {
    try {
      const docRef = this.collection.doc(notificationId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { success: false, deletedCount: 0, error: 'Notification not found' };
      }

      await docRef.delete();
      return { success: true, deletedCount: 1 };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteExpired(): Promise<DeleteResult> {
    try {
      let deletedCount = 0;
      let hasMore = true;

      while (hasMore) {
        const snapshot = await this.collection
          .where('expiresAt', '<', admin.firestore.Timestamp.now())
          .limit(BATCH_LIMIT)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = this.db.batch();
        for (const doc of snapshot.docs) {
          batch.delete(doc.ref);
        }

        await batch.commit();
        deletedCount += snapshot.size;

        if (snapshot.size < BATCH_LIMIT) {
          hasMore = false;
        }
      }

      return { success: true, deletedCount };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getUnreadCount(userId: string): Promise<UnreadCountResult> {
    const countSnapshot = await this.collection
      .where('userId', '==', userId)
      .where('read', '==', false)
      .count()
      .get();

    return { count: countSnapshot.data().count };
  }

  /**
   * Compute expiresAt based on retention config.
   * Priority: request.ttlSeconds > retention.perType[type] > retention.defaultTTLSeconds
   */
  private computeExpiresAt(type: string, ttlOverride?: number, now?: Date): Date {
    const baseTime = now ?? new Date();
    let ttlSeconds: number;

    if (ttlOverride !== undefined) {
      ttlSeconds = ttlOverride;
    } else if (this.retention.perType?.[type] !== undefined) {
      ttlSeconds = this.retention.perType[type];
    } else {
      ttlSeconds = this.retention.defaultTTLSeconds;
    }

    return new Date(baseTime.getTime() + ttlSeconds * 1000);
  }

  /**
   * Convert a Firestore document to an InboxNotification
   */
  private fromFirestore(doc: FirebaseFirestore.DocumentSnapshot): InboxNotification {
    const data = doc.data()!;
    return {
      id: doc.id,
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      data: data.data,
      priority: data.priority,
      read: data.read,
      readAt: data.readAt ? (data.readAt as admin.firestore.Timestamp).toDate() : null,
      createdAt: (data.createdAt as admin.firestore.Timestamp).toDate(),
      expiresAt: data.expiresAt ? (data.expiresAt as admin.firestore.Timestamp).toDate() : null,
      sourceEvent: data.sourceEvent,
      actionUrl: data.actionUrl,
      imageUrl: data.imageUrl,
      groupKey: data.groupKey,
    };
  }

  /**
   * Convert an InboxNotification record to Firestore-compatible data
   */
  private toFirestore(record: Omit<InboxNotification, 'id'>): Record<string, unknown> {
    const data: Record<string, unknown> = {
      userId: record.userId,
      type: record.type,
      title: record.title,
      body: record.body,
      priority: record.priority,
      read: record.read,
      readAt: record.readAt ? admin.firestore.Timestamp.fromDate(record.readAt) : null,
      createdAt: admin.firestore.Timestamp.fromDate(record.createdAt),
      expiresAt: record.expiresAt ? admin.firestore.Timestamp.fromDate(record.expiresAt) : null,
    };

    // Only write optional fields if they have values
    if (record.data !== undefined) data.data = record.data;
    if (record.sourceEvent !== undefined) data.sourceEvent = record.sourceEvent;
    if (record.actionUrl !== undefined) data.actionUrl = record.actionUrl;
    if (record.imageUrl !== undefined) data.imageUrl = record.imageUrl;
    if (record.groupKey !== undefined) data.groupKey = record.groupKey;

    return data;
  }
}
