/**
 * Notification Inbox Connector Barrel Export
 */

export * from './types';
export * from './notification-inbox-connector';
export * from './providers/firestore-provider';

import { NotificationInboxConnector } from './notification-inbox-connector';
import { FirestoreInboxProvider } from './providers/firestore-provider';

// Config is provided via initializeNotificationInboxConnector() at app startup
let connectorConfig: any = null;

export function initializeNotificationInboxConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  notificationInboxConnectorInstance = undefined;
}

export function createNotificationInboxConnector(): NotificationInboxConnector | null {
  if (!connectorConfig) {
    throw new Error('Notification inbox connector not initialized. Call initializeNotificationInboxConnector() first.');
  }

  if (!connectorConfig.notificationInbox.enabled) {
    return null;
  }

  const provider = connectorConfig.notificationInbox.provider;

  if (provider === 'firestore') {
    const config = connectorConfig.notificationInbox;
    return new NotificationInboxConnector(
      new FirestoreInboxProvider({
        collection: config.collection,
        retention: config.retention,
        databaseId: config.providers?.firestore?.databaseId,
      }),
    );
  }

  throw new Error(`Unsupported notification inbox provider: ${provider}`);
}

let notificationInboxConnectorInstance: NotificationInboxConnector | null | undefined;

export function getNotificationInboxConnector(): NotificationInboxConnector | null {
  if (notificationInboxConnectorInstance === undefined) {
    notificationInboxConnectorInstance = createNotificationInboxConnector();
  }
  return notificationInboxConnectorInstance;
}
