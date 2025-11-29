/**
 * Event Bus - Unit Tests
 *
 * Testing WHAT the event bus does, not HOW it works internally:
 * - Publishes and subscribes to events
 * - Type-safe event handling
 * - One-time subscriptions
 * - Unsubscribing from events
 * - Managing listener counts
 */

import { eventBus } from '../event-bus';
import { EventType, BaseEventPayload, UserCreatedPayload } from '../event-types';

describe('Event Bus', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    eventBus.clear();
  });

  afterEach(() => {
    // Ensure cleanup after each test
    eventBus.clear();
  });

  describe('publish and subscribe', () => {
    it('publishes event to subscribers', () => {
      const handler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler).toHaveBeenCalledWith({
        userUID: 'user-123',
        accountUID: 'account-456',
        timestamp: expect.any(Date),
      });
    });

    it('publishes event to multiple subscribers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.USER_CREATED, handler2);
      eventBus.subscribe(EventType.USER_CREATED, handler3);

      const payload: UserCreatedPayload = {
        userUID: 'user-123',
        accountUID: 'account-456',
      };

      eventBus.publish(EventType.USER_CREATED, payload);

      expect(handler1).toHaveBeenCalledWith(expect.objectContaining(payload));
      expect(handler2).toHaveBeenCalledWith(expect.objectContaining(payload));
      expect(handler3).toHaveBeenCalledWith(expect.objectContaining(payload));
    });

    it('only notifies subscribers of the correct event type', () => {
      const userCreatedHandler = jest.fn();
      const listCreatedHandler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, userCreatedHandler);
      eventBus.subscribe(EventType.LIST_CREATED, listCreatedHandler);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(userCreatedHandler).toHaveBeenCalled();
      expect(listCreatedHandler).not.toHaveBeenCalled();
    });

    it('adds timestamp to payload if not provided', () => {
      const handler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('preserves timestamp if provided in payload', () => {
      const handler = jest.fn();
      const customTimestamp = new Date('2024-01-01T00:00:00Z');

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
        timestamp: customTimestamp,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: customTimestamp,
        })
      );
    });

    it('handles async subscribers', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      // Wait for async handler to complete
      await new Promise(resolve => setImmediate(resolve));

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('subscribeOnce', () => {
    it('subscribes to event only once', () => {
      const handler = jest.fn();

      eventBus.subscribeOnce(EventType.USER_CREATED, handler);

      // Emit event twice
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-789',
        accountUID: 'account-101',
      });

      // Handler should be called only once
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userUID: 'user-123',
        })
      );
    });

    it('does not interfere with regular subscriptions', () => {
      const onceHandler = jest.fn();
      const regularHandler = jest.fn();

      eventBus.subscribeOnce(EventType.USER_CREATED, onceHandler);
      eventBus.subscribe(EventType.USER_CREATED, regularHandler);

      // Emit event twice
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-789',
        accountUID: 'account-101',
      });

      expect(onceHandler).toHaveBeenCalledTimes(1);
      expect(regularHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsubscribe', () => {
    it('unsubscribes specific handler from event', () => {
      const handler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.unsubscribe(EventType.USER_CREATED, handler);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribes only the specified handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.USER_CREATED, handler2);

      eventBus.unsubscribe(EventType.USER_CREATED, handler1);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('handles unsubscribing non-existent handler gracefully', () => {
      const handler = jest.fn();

      // Should not throw
      expect(() => {
        eventBus.unsubscribe(EventType.USER_CREATED, handler);
      }).not.toThrow();
    });
  });

  describe('unsubscribeAll', () => {
    it('unsubscribes all handlers from event type', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.USER_CREATED, handler2);
      eventBus.subscribe(EventType.USER_CREATED, handler3);

      eventBus.unsubscribeAll(EventType.USER_CREATED);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(handler3).not.toHaveBeenCalled();
    });

    it('only unsubscribes from specified event type', () => {
      const userHandler = jest.fn();
      const listHandler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, userHandler);
      eventBus.subscribe(EventType.LIST_CREATED, listHandler);

      eventBus.unsubscribeAll(EventType.USER_CREATED);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });
      eventBus.publish(EventType.LIST_CREATED, {
        listUID: 'list-123',
        listOwnerUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(userHandler).not.toHaveBeenCalled();
      expect(listHandler).toHaveBeenCalled();
    });

    it('handles unsubscribing from event with no listeners', () => {
      expect(() => {
        eventBus.unsubscribeAll(EventType.USER_CREATED);
      }).not.toThrow();
    });
  });

  describe('listenerCount', () => {
    it('returns correct count of listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(0);

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(1);

      eventBus.subscribe(EventType.USER_CREATED, handler2);
      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(2);
    });

    it('decreases count when unsubscribing', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.USER_CREATED, handler2);

      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(2);

      eventBus.unsubscribe(EventType.USER_CREATED, handler1);
      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(1);
    });

    it('returns 0 for event with no listeners', () => {
      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(0);
    });

    it('returns correct counts for different event types', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.LIST_CREATED, handler2);

      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(1);
      expect(eventBus.listenerCount(EventType.LIST_CREATED)).toBe(1);
      expect(eventBus.listenerCount(EventType.ITEM_CREATED)).toBe(0);
    });
  });

  describe('clear', () => {
    it('clears all event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.LIST_CREATED, handler2);

      eventBus.clear();

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });
      eventBus.publish(EventType.LIST_CREATED, {
        listUID: 'list-123',
        listOwnerUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('resets listener counts to zero', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.subscribe(EventType.LIST_CREATED, handler2);

      eventBus.clear();

      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(0);
      expect(eventBus.listenerCount(EventType.LIST_CREATED)).toBe(0);
    });

    it('allows new subscriptions after clear', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler1);
      eventBus.clear();
      eventBus.subscribe(EventType.USER_CREATED, handler2);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles empty payload', () => {
      const handler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {} as UserCreatedPayload);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('handles payload with many fields', () => {
      const handler = jest.fn();
      const payload: BaseEventPayload = {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
        nested: {
          field4: 'value4',
        },
      };

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, payload);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining(payload));
    });

    it('handles subscribing same handler multiple times', () => {
      const handler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.subscribe(EventType.USER_CREATED, handler);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      // Handler called multiple times (once per subscription)
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('handles errors thrown by subscribers gracefully', () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const successHandler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, errorHandler);
      eventBus.subscribe(EventType.USER_CREATED, successHandler);

      // Should not throw, but error handler will throw
      expect(() => {
        eventBus.publish(EventType.USER_CREATED, {
          userUID: 'user-123',
          accountUID: 'account-456',
        });
      }).not.toThrow();

      expect(errorHandler).toHaveBeenCalled();
      // In Node.js EventEmitter, subsequent handlers still run even if one throws
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe('max listeners', () => {
    it('allows up to 100 listeners without warnings', () => {
      const handlers = Array.from({ length: 100 }, () => jest.fn());

      handlers.forEach(handler => {
        eventBus.subscribe(EventType.USER_CREATED, handler);
      });

      expect(eventBus.listenerCount(EventType.USER_CREATED)).toBe(100);
    });
  });

  describe('type safety', () => {
    it('works with strongly typed payloads', () => {
      const handler = jest.fn((payload: UserCreatedPayload) => {
        // Type-safe access to payload fields
        expect(payload.userUID).toBeDefined();
        expect(payload.accountUID).toBeDefined();
      });

      eventBus.subscribe(EventType.USER_CREATED, handler);
      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('publish return value', () => {
    it('returns true when event has listeners', () => {
      eventBus.subscribe(EventType.USER_CREATED, jest.fn());

      const result = eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(result).toBe(true);
    });

    it('returns false when event has no listeners', () => {
      const result = eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(result).toBe(false);
    });
  });

  describe('multiple event types', () => {
    it('handles multiple different event types independently', () => {
      const userHandler = jest.fn();
      const listHandler = jest.fn();
      const itemHandler = jest.fn();

      eventBus.subscribe(EventType.USER_CREATED, userHandler);
      eventBus.subscribe(EventType.LIST_CREATED, listHandler);
      eventBus.subscribe(EventType.ITEM_CREATED, itemHandler);

      eventBus.publish(EventType.USER_CREATED, {
        userUID: 'user-123',
        accountUID: 'account-456',
      });

      eventBus.publish(EventType.LIST_CREATED, {
        listUID: 'list-123',
        listOwnerUID: 'user-123',
        accountUID: 'account-456',
      });

      expect(userHandler).toHaveBeenCalledTimes(1);
      expect(listHandler).toHaveBeenCalledTimes(1);
      expect(itemHandler).not.toHaveBeenCalled();
    });
  });
});
