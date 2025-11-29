/**
 * Push Notifications Connector Barrel Export
 */

export * from './types';
export * from './push-notifications-connector';
export * from './providers/fcm-provider';

import { PushNotificationsConnector } from './push-notifications-connector';
import { FCMProvider } from './providers/fcm-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createPushNotificationsConnector(): PushNotificationsConnector | null {
  if (!COMMUNICATIONS_CONFIG.pushNotifications.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.pushNotifications.provider;

  if (provider === 'fcm') {
    const config = COMMUNICATIONS_CONFIG.pushNotifications.providers.fcm;
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
