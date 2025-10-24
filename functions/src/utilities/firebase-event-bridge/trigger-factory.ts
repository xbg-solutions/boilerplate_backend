// src/utilities/firebase-event-bridge/trigger-factory.ts

import { Logger } from '../logger';
import { FirestoreConfig, AuthConfig, StorageConfig } from './config-types';
import { FirestoreAdapter } from './adapters/firestore-adapter';
import { AuthAdapter } from './adapters/auth-adapter';
import { StorageAdapter } from './adapters/storage-adapter';
import { NormalizedFirebaseEvent } from './normalizer';

export class TriggerFactory {
  constructor(
    private readonly logger: Logger,
    private readonly eventHandler: (event: NormalizedFirebaseEvent) => void
  ) {}

  /**
   * Generate all Firestore triggers based on config
   */
  generateFirestoreTriggers(config: FirestoreConfig): Record<string, any> {
    const triggers: Record<string, any> = {};
    const adapter = new FirestoreAdapter(this.logger, this.eventHandler);

    for (const dbConfig of config.databases) {
      for (const collectionConfig of dbConfig.collections) {
        for (const operation of collectionConfig.operations) {
          const trigger = adapter.createTrigger(
            dbConfig.databaseName,
            collectionConfig,
            operation
          );

          const triggerName = FirestoreAdapter.generateTriggerName(
            dbConfig.databaseName,
            collectionConfig.path,
            operation,
            collectionConfig.eventNameOverride
          );

          triggers[triggerName] = trigger;

          // ✅ Safe logging - only trigger metadata
          this.logger.debug('Firestore trigger generated', {
            triggerName,
            databaseName: dbConfig.databaseName,
            collection: collectionConfig.path,
            operation
          });
        }
      }
    }

    this.logger.info('Firestore triggers generated', {
      count: Object.keys(triggers).length,
      databaseCount: config.databases.length
    });

    return triggers;
  }

  /**
   * Generate all Auth triggers based on config
   */
  generateAuthTriggers(config: AuthConfig): Record<string, any> {
    const triggers: Record<string, any> = {};
    const adapter = new AuthAdapter(this.logger, this.eventHandler);

    for (const operation of config.operations) {
      const trigger = adapter.createTrigger(operation);
      const triggerName = AuthAdapter.generateTriggerName(operation);

      triggers[triggerName] = trigger;

      // ✅ Safe logging - only trigger metadata
      this.logger.debug('Auth trigger generated', {
        triggerName,
        operation
      });
    }

    this.logger.info('Auth triggers generated', {
      count: Object.keys(triggers).length
    });

    return triggers;
  }

  /**
   * Generate Storage trigger based on config
   */
  generateStorageTriggers(config: StorageConfig): Record<string, any> {
    const triggers: Record<string, any> = {};
    const adapter = new StorageAdapter(this.logger, this.eventHandler);

    const trigger = adapter.createTrigger(config);
    const triggerName = StorageAdapter.generateTriggerName();

    triggers[triggerName] = trigger;

    // ✅ Safe logging - only trigger metadata
    this.logger.debug('Storage trigger generated', {
      triggerName,
      pathPatterns: config.pathPatterns
    });

    this.logger.info('Storage triggers generated', {
      count: 1,
      pathPatterns: config.pathPatterns
    });

    return triggers;
  }
}