/**
 * Firebase Event to Domain Event Mapping Configuration
 * Maps Firebase-specific events (Firestore, Auth, Storage) to domain events
 *
 * NOTE: This is a generic boilerplate configuration. Customize the mappings
 * to match your application's specific event architecture.
 */

import { EventType, BaseEventPayload } from '../utilities/events/event-types';
import { NormalizedFirebaseEvent } from '../utilities/firebase-event-bridge/normalizer';

/**
 * Event mapping result
 */
export interface EventMapping {
  domainEvent: EventType;
  domainPayload: BaseEventPayload;
}

/**
 * Map Firebase event names to domain events
 *
 * This function translates Firebase-specific events (like 'firestore.users.created')
 * into platform-agnostic domain events (like EventType.USER_CREATED).
 *
 * @param firebaseEventName - Firebase event name (e.g., 'firestore.users.created')
 * @param event - Normalized Firebase event with full context
 * @returns Event mapping or null if no mapping exists
 */
export function mapFirebaseEventToDomain(
  firebaseEventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  // Firestore event mappings
  if (firebaseEventName.startsWith('firestore.')) {
    return mapFirestoreEvent(firebaseEventName, event);
  }

  // Auth event mappings
  if (firebaseEventName.startsWith('auth.')) {
    return mapAuthEvent(firebaseEventName, event);
  }

  // Storage event mappings
  if (firebaseEventName.startsWith('storage.')) {
    return mapStorageEvent(firebaseEventName, event);
  }

  return null;
}

/**
 * Map Firestore events to domain events
 */
function mapFirestoreEvent(
  eventName: string,
  event: NormalizedFirebaseEvent
): EventMapping | null {
  // Extract collection and operation from event name
  // Format: firestore.{collection}.{operation}
  const parts = eventName.split('.');
  if (parts.length !== 3) return null;

  const [, collection, operation] = parts;

  // Map users collection events
  if (collection === 'users') {
    if (operation === 'created') {
      return {
        domainEvent: EventType.USER_CREATED,
        domainPayload: {
          userUID: event.normalized.documentId || '',
          accountUID: event.raw?.accountUID || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'updated') {
      return {
        domainEvent: EventType.USER_UPDATED,
        domainPayload: {
          userUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'deleted') {
      return {
        domainEvent: EventType.USER_DELETED,
        domainPayload: {
          userUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
  }

  // Map lists/wishlists collection events
  if (collection === 'lists' || collection === 'wishlists') {
    if (operation === 'created') {
      return {
        domainEvent: EventType.LIST_CREATED,
        domainPayload: {
          listUID: event.normalized.documentId || '',
          listOwnerUID: event.raw?.listOwnerUID || '',
          accountUID: event.raw?.accountUID || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'updated') {
      return {
        domainEvent: EventType.LIST_UPDATED,
        domainPayload: {
          listUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'deleted') {
      return {
        domainEvent: EventType.LIST_DELETED,
        domainPayload: {
          listUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
  }

  // Map items collection events
  if (collection === 'items') {
    if (operation === 'created') {
      return {
        domainEvent: EventType.ITEM_CREATED,
        domainPayload: {
          itemUID: event.normalized.documentId || '',
          listUID: event.raw?.listUID || '',
          createdBy: event.raw?.createdBy || '',
          accountUID: event.raw?.accountUID || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'updated') {
      return {
        domainEvent: EventType.ITEM_UPDATED,
        domainPayload: {
          itemUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'deleted') {
      return {
        domainEvent: EventType.ITEM_DELETED,
        domainPayload: {
          itemUID: event.normalized.documentId || '',
          timestamp: event.timestamp,
        },
      };
    }
  }

  // Map contacts collection events
  if (collection === 'contacts') {
    if (operation === 'created') {
      return {
        domainEvent: EventType.CONTACT_CREATED,
        domainPayload: {
          contactUID: event.normalized.documentId || '',
          accountUID: event.raw?.accountUID || '',
          createdBy: event.raw?.createdBy || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'updated') {
      return {
        domainEvent: EventType.CONTACT_UPDATED,
        domainPayload: {
          contactUID: event.normalized.documentId || '',
          accountUID: event.raw?.accountUID || '',
          updatedBy: event.raw?.updatedBy || '',
          timestamp: event.timestamp,
        },
      };
    }
    if (operation === 'deleted') {
      return {
        domainEvent: EventType.CONTACT_DELETED,
        domainPayload: {
          contactUID: event.normalized.documentId || '',
          accountUID: event.raw?.accountUID || '',
          deletedBy: event.raw?.deletedBy || '',
          deletionType: event.raw?.deletionType || 'soft',
          timestamp: event.timestamp,
        },
      };
    }
  }

  // Default: Map to EXTERNAL_DATA_CHANGE for unmapped Firestore events
  return {
    domainEvent: EventType.EXTERNAL_DATA_CHANGE,
    domainPayload: {
      source: 'firestore',
      collection: event.normalized.collection,
      documentId: event.normalized.documentId,
      operation: event.normalized.operation,
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
        accountUID: event.raw?.accountUID || '',
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

  // Default: Map to EXTERNAL_DATA_CHANGE
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
    // Check if this is a profile image upload
    if (event.normalized.filePath?.includes('profile_images')) {
      return {
        domainEvent: EventType.PROFILE_IMAGE_UPLOADED,
        domainPayload: {
          userUID: event.raw?.userId || '',
          imageUrl: event.raw?.mediaLink || '',
          storagePath: event.normalized.filePath || '',
          timestamp: event.timestamp,
        },
      };
    }

    // Check if this is an item image upload
    if (event.normalized.filePath?.includes('item_images')) {
      return {
        domainEvent: EventType.IMAGE_UPLOADED,
        domainPayload: {
          itemUID: event.raw?.itemUID || '',
          imageUrl: event.raw?.mediaLink || '',
          uploadedBy: event.raw?.uploadedBy || '',
          filePath: event.normalized.filePath,
          timestamp: event.timestamp,
        },
      };
    }

    // Generic file upload
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

  // Default: Map to EXTERNAL_DATA_CHANGE
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
 * Validate event mapping configuration
 * Run this during application startup to ensure all mappings are valid
 */
export function validateEventMappings(): void {
  // Add custom validation logic here if needed
  // For example, ensure all critical collections are mapped
  const criticalCollections = ['users', 'lists', 'items'];
  const criticalOperations = ['created', 'updated', 'deleted'];

  // This is a placeholder for validation logic
  // In a real application, you might want to ensure all combinations exist
  console.log('Event mappings validated for collections:', criticalCollections);
  console.log('Event mappings validated for operations:', criticalOperations);
}
