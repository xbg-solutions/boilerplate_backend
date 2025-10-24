// src/utilities/firebase-event-bridge/adapters/storage-adapter.ts

import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { Logger } from '../../logger';
import { StorageConfig } from '../config-types';
import { normalizeStorageEvent, NormalizedFirebaseEvent } from '../normalizer';

export class StorageAdapter {
  constructor(
    private readonly logger: Logger,
    private readonly eventHandler: (event: NormalizedFirebaseEvent) => void
  ) {}

  /**
   * Create Storage trigger
   */
  createTrigger(config: StorageConfig): any {
    return onObjectFinalized(async (event) => {
      const filePath = event.data.name;
      
      // Check if file matches configured path patterns
      if (!this.matchesPathPattern(filePath, config.pathPatterns)) {
        this.logger.debug('Storage event skipped - path not matched', {
          filePath,
          patterns: config.pathPatterns
        });
        return;
      }

      const metadata = config.includeMetadata ? {
        name: event.data.name,
        bucket: event.data.bucket,
        contentType: event.data.contentType,
        size: event.data.size,
        timeCreated: event.data.timeCreated,
        updated: event.data.updated,
        metadata: event.data.metadata,
        md5Hash: event.data.md5Hash
      } : undefined;
      
      // ✅ Safe logging - only file path
      this.logger.debug('Storage onFinalized triggered', {
        filePath,
        contentType: event.data.contentType,
        size: event.data.size
        // ❌ NEVER LOG: metadata content (may contain user-uploaded info)
      });

      const normalizedEvent = normalizeStorageEvent(
        filePath,
        metadata,
        this.logger
      );

      this.eventHandler(normalizedEvent);
    });
  }

  /**
   * Check if file path matches any configured pattern
   */
  private matchesPathPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Convert glob pattern to regex
      // 'items/**' -> '^items/.*$'
      // 'profiles/*' -> '^profiles/[^/]+$'
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]+')
        .replace(/\//g, '\\/');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    });
  }

  /**
   * Generate trigger function name
   */
  static generateTriggerName(): string {
    return 'storageObjectFinalized';
  }
}