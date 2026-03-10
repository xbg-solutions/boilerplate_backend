/**
 * Event Type Definitions
 *
 * Base event types for the internal event bus. These cover the standard
 * lifecycle events that most applications need out of the box.
 *
 * ─── Extending with project-specific events ───────────────────────────
 *
 * The code generator adds entity-specific CRUD events automatically
 * (e.g. ORDER_CREATED, PRODUCT_UPDATED) via BaseService.publishEvent().
 * Those events are cast to EventType at runtime, so they work with the
 * event bus without being listed here.
 *
 * To add custom domain events (e.g. ORDER_SHIPPED, PAYMENT_FAILED):
 *
 *   1. Add the new member to this enum.
 *   2. Optionally define a typed payload interface below.
 *   3. Add the mapping to EventPayloadMap for full type safety.
 *   4. Subscribe in your service or in subscribers/.
 *
 * The enum is deliberately kept small so that new projects start clean
 * and only grow the event catalogue as needed.
 */

export enum EventType {
  // ── User lifecycle ────────────────────────────────────────
  USER_CREATED = 'user.created',
  USER_UPDATED = 'user.updated',
  USER_DELETED = 'user.deleted',

  // ── Authentication ────────────────────────────────────────
  AUTH_LOGIN = 'auth.login',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_TOKEN_REFRESHED = 'auth.token_refreshed',
  AUTH_TOKEN_BLACKLISTED = 'auth.token_blacklisted',
  AUTH_PASSWORD_CHANGED = 'auth.password_changed',

  // ── File / Storage ────────────────────────────────────────
  FILE_UPLOADED = 'file.uploaded',
  FILE_DELETED = 'file.deleted',

  // ── Notifications ─────────────────────────────────────────
  NOTIFICATION_SENT = 'notification.sent',
  NOTIFICATION_FAILED = 'notification.failed',

  // ── System ────────────────────────────────────────────────
  /** Catch-all for external data changes (Firebase triggers, webhooks, etc.) */
  EXTERNAL_DATA_CHANGE = 'external.data.change',
}

// ──────────────────────────────────────────────────────────
// Base payload
// ──────────────────────────────────────────────────────────

/**
 * Every event payload extends this interface.
 * The event bus adds a `timestamp` automatically if one is not provided.
 */
export interface BaseEventPayload {
  timestamp?: Date;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────
// Standard payload types
// ──────────────────────────────────────────────────────────

/** Payload published by BaseService on entity creation */
export interface EntityCreatedPayload extends BaseEventPayload {
  entityId: string;
  entityType: string;
  action: 'CREATED';
  userId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

/** Payload published by BaseService on entity update */
export interface EntityUpdatedPayload extends BaseEventPayload {
  entityId: string;
  entityType: string;
  action: 'UPDATED';
  userId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

/** Payload published by BaseService on entity deletion */
export interface EntityDeletedPayload extends BaseEventPayload {
  entityId: string;
  entityType: string;
  action: 'DELETED';
  userId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

/** User lifecycle events */
export interface UserCreatedPayload extends BaseEventPayload {
  userUID: string;
  email?: string;
}

export interface UserUpdatedPayload extends BaseEventPayload {
  userUID: string;
}

export interface UserDeletedPayload extends BaseEventPayload {
  userUID: string;
}

/** Authentication events */
export interface AuthLoginPayload extends BaseEventPayload {
  userUID: string;
  method?: string;
}

export interface AuthLogoutPayload extends BaseEventPayload {
  userUID: string;
}

export interface AuthTokenBlacklistedPayload extends BaseEventPayload {
  userUID: string;
  reason?: string;
}

/** File events */
export interface FileUploadedPayload extends BaseEventPayload {
  filePath: string;
  contentType?: string;
  size?: number;
  bucket?: string;
}

export interface FileDeletedPayload extends BaseEventPayload {
  filePath: string;
}

/** Notification events */
export interface NotificationSentPayload extends BaseEventPayload {
  channel: 'email' | 'sms' | 'push' | string;
  recipientId?: string;
}

export interface NotificationFailedPayload extends BaseEventPayload {
  channel: 'email' | 'sms' | 'push' | string;
  recipientId?: string;
  error?: string;
}

/** External data change (Firebase triggers, webhooks, etc.) */
export interface ExternalDataChangePayload extends BaseEventPayload {
  source: 'firestore' | 'auth' | 'storage' | string;
  collection?: string;
  documentId?: string;
  operation?: string;
  userId?: string;
  filePath?: string;
}

// ──────────────────────────────────────────────────────────
// Type-safe payload map
// ──────────────────────────────────────────────────────────

/**
 * Maps each EventType to its strongly-typed payload.
 * Extend this map when adding new event types.
 */
export interface EventPayloadMap {
  [EventType.USER_CREATED]: UserCreatedPayload;
  [EventType.USER_UPDATED]: UserUpdatedPayload;
  [EventType.USER_DELETED]: UserDeletedPayload;
  [EventType.AUTH_LOGIN]: AuthLoginPayload;
  [EventType.AUTH_LOGOUT]: AuthLogoutPayload;
  [EventType.AUTH_TOKEN_REFRESHED]: BaseEventPayload;
  [EventType.AUTH_TOKEN_BLACKLISTED]: AuthTokenBlacklistedPayload;
  [EventType.AUTH_PASSWORD_CHANGED]: BaseEventPayload;
  [EventType.FILE_UPLOADED]: FileUploadedPayload;
  [EventType.FILE_DELETED]: FileDeletedPayload;
  [EventType.NOTIFICATION_SENT]: NotificationSentPayload;
  [EventType.NOTIFICATION_FAILED]: NotificationFailedPayload;
  [EventType.EXTERNAL_DATA_CHANGE]: ExternalDataChangePayload;
}
