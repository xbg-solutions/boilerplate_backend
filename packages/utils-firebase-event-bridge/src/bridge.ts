// src/utilities/firebase-event-bridge/bridge.ts

import { Logger } from '@xbg.solutions/utils-logger';
import { EventType } from '@xbg.solutions/utils-events';
import { FirebaseEventBridgeConfig } from './config-types';
import { TriggerFactory } from './trigger-factory';
import { NormalizedFirebaseEvent } from './normalizer';

/**
 * Type for the event mapping function provided at app startup.
 * Maps a Firebase event name + normalized event to a domain event + payload,
 * or returns null/undefined if no mapping exists.
 */
export type MapFirebaseEventToDomainFn = (
  eventName: string,
  event: NormalizedFirebaseEvent
) => { domainEvent: string; domainPayload: any } | null | undefined;

// Event mapping function is provided via initializeFirebaseEventBridge() at app startup
let mapFirebaseEventToDomain: MapFirebaseEventToDomainFn | null = null;

/**
 * Initialize the Firebase Event Bridge with the event mapping function.
 * Must be called at app startup before generating triggers.
 */
export function initializeFirebaseEventBridge(mapFn: MapFirebaseEventToDomainFn): void {
  mapFirebaseEventToDomain = mapFn;
}

export class FirebaseEventBridge {
  private readonly logger: Logger;
  private readonly config: FirebaseEventBridgeConfig;
  private readonly triggerFactory: TriggerFactory;

  constructor(config: FirebaseEventBridgeConfig) {
    this.config = config;
    this.logger = new Logger('firebase-event-bridge', { 
      component: 'firebase-event-bridge' 
    });
    this.triggerFactory = new TriggerFactory(
      this.logger,
      this.handleEvent.bind(this)
    );
  }

  /**
   * Generate all Firebase trigger functions based on config
   */
  generateTriggers(): Record<string, any> {
    const triggers: Record<string, any> = {};

    // Generate Firestore triggers
    if (this.config.firestore?.enabled) {
      const firestoreTriggers = this.triggerFactory.generateFirestoreTriggers(
        this.config.firestore
      );
      Object.assign(triggers, firestoreTriggers);
    }

    // Generate Auth triggers
    if (this.config.auth?.enabled) {
      const authTriggers = this.triggerFactory.generateAuthTriggers(
        this.config.auth
      );
      Object.assign(triggers, authTriggers);
    }

    // Generate Storage triggers
    if (this.config.storage?.enabled) {
      const storageTriggers = this.triggerFactory.generateStorageTriggers(
        this.config.storage
      );
      Object.assign(triggers, storageTriggers);
    }

    this.logger.info('Firebase Event Bridge initialized', {
      totalTriggers: Object.keys(triggers).length,
      firestoreEnabled: this.config.firestore?.enabled || false,
      authEnabled: this.config.auth?.enabled || false,
      storageEnabled: this.config.storage?.enabled || false
    });

    return triggers;
  }

  /**
   * Central event handler - publishes to event bus with error handling
   *
   * Maps Firebase-specific events to platform-agnostic domain events.
   * This ensures subscribers remain unaware of the event source.
   *
   * ⚠️ LOGGING SAFETY: Never logs event payload (raw data)
   */
  private handleEvent(event: NormalizedFirebaseEvent): void {
    try {
      // ✅ Safe logging - only event metadata
      this.logger.debug('Firebase event received', {
        firebaseEventName: event.eventName,
        eventId: event.eventId,
        source: event.source,
        documentId: event.normalized.documentId,
        userId: event.normalized.userId,
        filePath: event.normalized.filePath
        // ❌ NEVER LOG: event.raw, event.changes
      });

      // Map Firebase event to domain event
      if (!mapFirebaseEventToDomain) {
        this.logger.warn('Firebase Event Bridge not initialized. Call initializeFirebaseEventBridge() first.');
        return;
      }
      const mapping = mapFirebaseEventToDomain(event.eventName, event);

      if (!mapping) {
        this.logger.warn('No domain event mapping found for Firebase event', {
          firebaseEventName: event.eventName,
          eventId: event.eventId
        });
        return;
      }

      const { domainEvent, domainPayload } = mapping;

      // ✅ Safe logging - mapping result
      this.logger.debug('Firebase event mapped to domain event', {
        firebaseEventName: event.eventName,
        domainEvent,
        eventId: event.eventId
      });

      // Publish domain event to internal event bus
      this.config.eventBus.publish(domainEvent as EventType, domainPayload);

      // ✅ Safe logging - only metadata
      this.logger.debug('Domain event published to bus', {
        domainEvent,
        firebaseEventName: event.eventName,
        listenerCount: this.config.eventBus.listenerCount(domainEvent as EventType)
      });
    } catch (error) {
      // Swallow error and emit error event
      this.logger.error('Failed to handle Firebase event', error as Error, {
        eventName: event.eventName,
        eventId: event.eventId,
        source: event.source
        // ❌ NEVER LOG: event payload, error with full context
      });

      // Note: Not emitting error event as EventType doesn't have system errors
      // Could be added if needed
    }
  }
}