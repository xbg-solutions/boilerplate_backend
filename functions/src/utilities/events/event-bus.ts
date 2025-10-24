/**
 * Internal Event Bus
 * 
 * Decouples components via publish/subscribe pattern.
 * Uses Node.js EventEmitter for reliability.
 */

import { EventEmitter } from 'events';
import { EventType, BaseEventPayload } from './event-types';

class EventBus extends EventEmitter {
  constructor() {
    super();
    
    // Increase max listeners to avoid warnings in complex workflows
    this.setMaxListeners(100);
  }

  /**
   * Emit an event with type-safe payload
   */
  publish<T extends BaseEventPayload>(
    eventType: EventType,
    payload: T
  ): boolean {
    // Add timestamp if not provided
    if (!payload.timestamp) {
      payload.timestamp = new Date();
    }

    return this.emit(eventType, payload);
  }

  /**
   * Subscribe to an event
   */
  subscribe<T extends BaseEventPayload>(
    eventType: EventType,
    handler: (payload: T) => void | Promise<void>
  ): void {
    this.on(eventType, handler);
  }

  /**
   * Subscribe to an event (one-time only)
   */
  subscribeOnce<T extends BaseEventPayload>(
    eventType: EventType,
    handler: (payload: T) => void | Promise<void>
  ): void {
    this.once(eventType, handler);
  }

  /**
   * Unsubscribe from an event
   */
  unsubscribe<T extends BaseEventPayload>(
    eventType: EventType,
    handler: (payload: T) => void | Promise<void>
  ): void {
    this.off(eventType, handler);
  }

  /**
   * Unsubscribe all handlers for an event type
   */
  unsubscribeAll(eventType: EventType): void {
    this.removeAllListeners(eventType);
  }

  /**
   * Get count of listeners for an event type
   */
  listenerCount(eventType: EventType): number {
    return super.listenerCount(eventType);
  }

  /**
   * Clear all event listeners (useful for testing)
   */
  clear(): void {
    this.removeAllListeners();
  }
}

// Singleton instance
export const eventBus = new EventBus();