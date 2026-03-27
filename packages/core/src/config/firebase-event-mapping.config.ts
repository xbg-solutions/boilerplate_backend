/**
 * Firebase Event to Domain Event Mapping Configuration
 *
 * Maps Firebase-specific events (Firestore, Auth, Storage) to domain events.
 *
 * ─── How it works ─────────────────────────────────────────────────────
 *
 * Firestore events are mapped dynamically:
 *   firestore.{collection}.{operation}  →  {COLLECTION}_CREATED / UPDATED / DELETED
 *
 * This means any collection automatically gets CRUD events on the event bus
 * without needing an explicit mapping here.
 *
 * Auth and Storage events are mapped to the standard EventType members.
 *
 * To add custom mappings (e.g. a specific collection should publish a
 * specialised event), add an entry to CUSTOM_FIRESTORE_MAPPINGS below.
 */

import { EventType, BaseEventPayload } from '@xbg.solutions/utils-events';
import { NormalizedFirebaseEvent } from '@xbg.solutions/utils-firebase-event-bridge';

/**
 * Event mapping result
 */
export interface EventMapping {
  domainEvent: EventType;
  domainPayload: BaseEventPayload;
}

/**
 * Optional per-collection overrides.
 * Key: collection name, Value: partial map of operation → EventType.
 *
 * Example – to map 'users' collection create events to USER_CREATED:
 *   users: { created: EventType.USER_CREATED }
 */
const CUSTOM_FIRESTORE_MAPPINGS: Record<string, Partial<Record<string, EventType>>> = {
  users: {
    created: EventType.USER_CREATED,
    updated: EventType.USER_UPDATED,
    deleted: EventType.USER_DELETED,
  },
};

/**
 * Map a Firebase event to a domain event.
 *
 * @param firebaseEventName - e.g. 'firestore.users.created', 'auth.user.created'
 * @param event - Normalized Firebase event with full context
 * @returns Event mapping or null if no mapping exists
 */
export function mapFirebaseEventToDomain(
  firebaseEventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  if (firebaseEventName.startsWith('firestore.')) {
    return mapFirestoreEvent(firebaseEventName, event);
  }

  if (firebaseEventName.startsWith('auth.')) {
    return mapAuthEvent(firebaseEventName, event);
  }

  if (firebaseEventName.startsWith('storage.')) {
    return mapStorageEvent(firebaseEventName, event);
  }

  return null;
}

/**
 * Map Firestore events to domain events.
 *
 * If a custom mapping exists for the collection + operation, use it.
 * Otherwise, fall back to EXTERNAL_DATA_CHANGE with full metadata
 * so subscribers can still react to any collection change.
 */
function mapFirestoreEvent(
  eventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  const parts = eventName.split('.');
  if (parts.length !== 3) return null;

  const [, collection, operation] = parts;

  // Check custom mappings first
  const customMapping = CUSTOM_FIRESTORE_MAPPINGS[collection]?.[operation];
  if (customMapping) {
    return {
      domainEvent: customMapping,
      domainPayload: {
        documentId: event.normalized.documentId || '',
        collection,
        operation,
        timestamp: event.timestamp,
      },
    };
  }

  // Dynamic mapping: cast "{COLLECTION}_{OPERATION}" as EventType.
  // BaseService publishes events in this same format, so subscribers
  // that listen for e.g. "ORDER_CREATED" will receive both API-driven
  // and Firestore-trigger-driven events.
  const dynamicEventType = `${collection}.${operation}` as EventType;
  return {
    domainEvent: dynamicEventType,
    domainPayload: {
      documentId: event.normalized.documentId || '',
      collection,
      operation,
      timestamp: event.timestamp,
    },
  };
}

/**
 * Map Auth events to domain events
 */
function mapAuthEvent(
  eventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  if (eventName === 'auth.user.created') {
    return {
      domainEvent: EventType.USER_CREATED,
      domainPayload: {
        userUID: event.normalized.userId || '',
        timestamp: event.timestamp,
      },
    };
  }

  if (eventName === 'auth.user.deleted') {
    return {
      domainEvent: EventType.USER_DELETED,
      domainPayload: {
        userUID: event.normalized.userId || '',
        timestamp: event.timestamp,
      },
    };
  }

  return {
    domainEvent: EventType.EXTERNAL_DATA_CHANGE,
    domainPayload: {
      source: 'auth',
      userId: event.normalized.userId,
      operation: event.normalized.operation,
      timestamp: event.timestamp,
    },
  };
}

/**
 * Map Storage events to domain events
 */
function mapStorageEvent(
  eventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  if (eventName === 'storage.object.finalized') {
    return {
      domainEvent: EventType.FILE_UPLOADED,
      domainPayload: {
        filePath: event.normalized.filePath || '',
        contentType: event.raw?.contentType,
        size: event.raw?.size,
        bucket: event.raw?.bucket,
        timestamp: event.timestamp,
      },
    };
  }

  if (eventName === 'storage.object.deleted') {
    return {
      domainEvent: EventType.FILE_DELETED,
      domainPayload: {
        filePath: event.normalized.filePath || '',
        timestamp: event.timestamp,
      },
    };
  }

  return {
    domainEvent: EventType.EXTERNAL_DATA_CHANGE,
    domainPayload: {
      source: 'storage',
      filePath: event.normalized.filePath,
      operation: event.normalized.operation,
      timestamp: event.timestamp,
    },
  };
}

/**
 * Validate event mapping configuration.
 * Run during application startup to surface issues early.
 */
export function validateEventMappings(): void {
  // Verify custom mappings reference valid EventType values
  for (const [collection, ops] of Object.entries(CUSTOM_FIRESTORE_MAPPINGS)) {
    for (const [operation, eventType] of Object.entries(ops)) {
      if (!Object.values(EventType).includes(eventType as EventType)) {
        console.warn(
          `Custom event mapping for ${collection}.${operation} references unknown EventType: ${eventType}`
        );
      }
    }
  }
}
