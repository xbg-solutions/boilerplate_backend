// src/utilities/firebase-event-bridge/adapters/firestore-adapter.ts

import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { Logger } from '../../logger';
import { DatabaseName } from '../../../config/firestore.config';
import { FirestoreCollectionConfig, FirestoreOperation } from '../config-types';
import { normalizeFirestoreEvent, extractCollectionName, NormalizedFirebaseEvent } from '../normalizer';

export class FirestoreAdapter {
  constructor(
    private readonly logger: Logger,
    private readonly eventHandler: (event: NormalizedFirebaseEvent) => void
  ) {}

  /**
   * Create Firestore trigger for a specific operation
   */
  createTrigger(
    databaseName: DatabaseName,
    config: FirestoreCollectionConfig,
    operation: FirestoreOperation
  ): any {
    const documentPath = `${config.path}/{id}`;
    const database = this.getDatabaseIdentifier(databaseName);
    
    switch (operation) {
      case 'create':
        return this.createOnCreate(databaseName, database, documentPath, config);
      case 'update':
        return this.createOnUpdate(databaseName, database, documentPath, config);
      case 'delete':
        return this.createOnDelete(databaseName, database, documentPath, config);
    }
  }

  /**
   * Map DatabaseName to Firebase database identifier
   */
  private getDatabaseIdentifier(databaseName: DatabaseName): string {
    const mapping: Record<DatabaseName, string> = {
      identityDB: 'identity',
      wishlistDB: 'wishlist',
      relationshipsDB: 'relationships',
      coordinationDB: 'coordination',
      communicationsDB: 'communications',
      systemDB: 'system'
    };
    return mapping[databaseName];
  }

  /**
   * Create onCreate trigger
   */
  private createOnCreate(
    databaseName: DatabaseName,
    database: string,
    documentPath: string,
    config: FirestoreCollectionConfig
  ): any {
    return onDocumentCreated(
      { document: documentPath, database },
      async (event) => {
        const documentId = event.params.id;
        const data = config.includeData ? event.data?.data() : undefined;
        
        // ✅ Safe logging - only metadata
        this.logger.debug('Firestore onCreate triggered', {
          databaseName,
          collection: config.path,
          documentId,
          operation: 'create'
          // ❌ NEVER LOG: data, event.data
        });

        const collectionName = extractCollectionName(config.path);
        const normalizedEvent = normalizeFirestoreEvent(
          'created',
          event.document,
          documentId,
          databaseName,
          collectionName,
          data,
          this.logger,
          config.eventNameOverride
        );

        this.eventHandler(normalizedEvent);
      }
    );
  }

  /**
   * Create onUpdate trigger
   */
  private createOnUpdate(
    databaseName: DatabaseName,
    database: string,
    documentPath: string,
    config: FirestoreCollectionConfig
  ): any {
    return onDocumentUpdated(
      { document: documentPath, database },
      async (event) => {
        const documentId = event.params.id;
        const before = config.includeData ? event.data?.before.data() : undefined;
        const after = config.includeData ? event.data?.after.data() : undefined;
        
        // ✅ Safe logging - only metadata
        this.logger.debug('Firestore onUpdate triggered', {
          databaseName,
          collection: config.path,
          documentId,
          operation: 'update'
          // ❌ NEVER LOG: before, after, event.data
        });

        const collectionName = extractCollectionName(config.path);
        const normalizedEvent = normalizeFirestoreEvent(
          'updated',
          event.document,
          documentId,
          databaseName,
          collectionName,
          after,
          this.logger,
          config.eventNameOverride,
          config.includeData ? { before, after } : undefined
        );

        this.eventHandler(normalizedEvent);
      }
    );
  }

  /**
   * Create onDelete trigger
   */
  private createOnDelete(
    databaseName: DatabaseName,
    database: string,
    documentPath: string,
    config: FirestoreCollectionConfig
  ): any {
    return onDocumentDeleted(
      { document: documentPath, database },
      async (event) => {
        const documentId = event.params.id;
        const data = config.includeData ? event.data?.data() : undefined;
        
        // ✅ Safe logging - only metadata
        this.logger.debug('Firestore onDelete triggered', {
          databaseName,
          collection: config.path,
          documentId,
          operation: 'delete'
          // ❌ NEVER LOG: data, event.data
        });

        const collectionName = extractCollectionName(config.path);
        const normalizedEvent = normalizeFirestoreEvent(
          'deleted',
          event.document,
          documentId,
          databaseName,
          collectionName,
          data,
          this.logger,
          config.eventNameOverride
        );

        this.eventHandler(normalizedEvent);
      }
    );
  }

  /**
   * Generate trigger function name
   */
  static generateTriggerName(
    databaseName: string,
    collectionPath: string,
    operation: string,
    eventNameOverride?: string
  ): string {
    // Remove database suffix and convert to camelCase
    const dbPrefix = databaseName.replace('DB', '');
    
    // Use override if provided, otherwise extract from path
    const collection = eventNameOverride || extractCollectionName(collectionPath);
    
    // Convert to camelCase and capitalize first letter
    const collectionName = collection
      .split('_')
      .map((part, index) => 
        index === 0 
          ? part.charAt(0).toUpperCase() + part.slice(1)
          : part.charAt(0).toUpperCase() + part.slice(1)
      )
      .join('');
    
    const operationName = operation.charAt(0).toUpperCase() + operation.slice(1);
    
    return `${dbPrefix}${collectionName}${operationName}`;
  }
}