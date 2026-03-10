/**
 * Push Notifications Connector Barrel Export
 */

export * from './types';
export * from './push-notifications-connector';
export * from './providers/fcm-provider';

import { PushNotificationsConnector } from './push-notifications-connector';
import { FCMProvider } from './providers/fcm-provider';

// Config is provided via initializePushNotificationsConnector() at app startup
let connectorConfig: any = null;

export function initializePushNotificationsConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  pushNotificationsConnectorInstance = undefined;
}

export function createPushNotificationsConnector(): PushNotificationsConnector | null {
  if (!connectorConfig) {
    throw new Error('Push notifications connector not initialized. Call initializePushNotificationsConnector() first.');
  }

  if (!connectorConfig.pushNotifications.enabled) {
    return null;
  }

  const provider = connectorConfig.pushNotifications.provider;

  if (provider === 'fcm') {
    const config = connectorConfig.pushNotifications.providers.fcm;
    return new PushNotificationsConnector(new FCMProvider(config));
  }

  throw new Error(`Unsupported push notifications provider: ${provider}`);
}

let pushNotificationsConnectorInstance: PushNotificationsConnector | null | undefined;

export function getPushNotificationsConnector(): PushNotificationsConnector | null {
  if (pushNotificationsConnectorInstance === undefined) {
    pushNotificationsConnectorInstance = createPushNotificationsConnector();
  }
  return pushNotificationsConnectorInstance;
}
