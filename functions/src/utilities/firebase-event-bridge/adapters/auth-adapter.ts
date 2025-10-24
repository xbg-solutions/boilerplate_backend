// src/utilities/firebase-event-bridge/adapters/auth-adapter.ts

import { Logger } from '../../logger';
import { AuthOperation } from '../config-types';
import { normalizeAuthEvent, NormalizedFirebaseEvent } from '../normalizer';

export class AuthAdapter {
  constructor(
    private readonly logger: Logger,
    private readonly eventHandler: (event: NormalizedFirebaseEvent) => void
  ) {}

  /**
   * Create Auth trigger for a specific operation
   * 
   * Note: Firebase Functions v2 uses blocking functions (beforeUserCreated)
   * rather than event functions. For true event-based triggers, we need to
   * use Firestore triggers on the users collection instead.
   */
  createTrigger(operation: AuthOperation): any {
    switch (operation) {
      case 'create':
        return this.createOnUserCreated();
      case 'delete':
        return this.createOnUserDeleted();
    }
  }

  /**
   * Create trigger for user creation
   * Uses Firestore trigger on users collection as workaround
   * since Firebase Auth doesn't provide direct onCreate events in v2
   */
  private createOnUserCreated(): any {
    // Import here to avoid circular dependency
    const { onDocumentCreated } = require('firebase-functions/v2/firestore');
    
    return onDocumentCreated(
      { document: 'users/{userId}', database: 'identity' },
      async (event: any) => {
        const userId = event.params.userId;
        const userData = event.data?.data();
        
        // ✅ Safe logging - only userId
        this.logger.debug('Auth user created (via Firestore)', {
          userId,
          operation: 'create'
          // ❌ NEVER LOG: userData
        });

        const normalizedEvent = normalizeAuthEvent(
          'created',
          userId,
          userData,
          this.logger
        );

        this.eventHandler(normalizedEvent);
      }
    );
  }

  /**
   * Create trigger for user deletion
   * Uses Firestore trigger on users collection
   */
  private createOnUserDeleted(): any {
    // Import here to avoid circular dependency
    const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
    
    return onDocumentDeleted(
      { document: 'users/{userId}', database: 'identity' },
      async (event: any) => {
        const userId = event.params.userId;
        const userData = event.data?.data();
        
        // ✅ Safe logging - only userId
        this.logger.debug('Auth user deleted (via Firestore)', {
          userId,
          operation: 'delete'
          // ❌ NEVER LOG: userData
        });

        const normalizedEvent = normalizeAuthEvent(
          'deleted',
          userId,
          userData,
          this.logger
        );

        this.eventHandler(normalizedEvent);
      }
    );
  }

  /**
   * Generate trigger function name
   */
  static generateTriggerName(operation: string): string {
    const operationName = operation.charAt(0).toUpperCase() + operation.slice(1);
    return `authUser${operationName}`;
  }
}