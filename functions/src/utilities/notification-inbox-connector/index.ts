/**
 * Notification Inbox Connector Barrel Export
 */

export * from './types';
export * from './notification-inbox-connector';
export * from './providers/firestore-provider';

import { NotificationInboxConnector } from './notification-inbox-connector';
import { FirestoreInboxProvider } from './providers/firestore-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createNotificationInboxConnector(): NotificationInboxConnector | null {
  if (!COMMUNICATIONS_CONFIG.notificationInbox.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.notificationInbox.provider;

  if (provider === 'firestore') {
    const config = COMMUNICATIONS_CONFIG.notificationInbox;
    return new NotificationInboxConnector(
      new FirestoreInboxProvider({
        collection: config.collection,
        retention: config.retention,
        databaseId: config.providers.firestore?.databaseId,
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
