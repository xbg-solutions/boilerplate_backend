/**
 * SMS Connector Barrel Export
 */

export * from './types';
export * from './sms-connector';
export * from './providers/twilio-provider';
export * from './providers/messagebird-provider';

import { SMSConnector } from './sms-connector';
import { TwilioProvider } from './providers/twilio-provider';
import { MessageBirdProvider } from './providers/messagebird-provider';

// Config is provided via initializeSMSConnector() at app startup
let connectorConfig: any = null;

export function initializeSMSConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  smsConnectorInstance = undefined;
}

/**
 * Factory function to create SMS connector with configuration
 */
export function createSMSConnector(): SMSConnector | null {
  if (!connectorConfig) {
    throw new Error('SMS connector not initialized. Call initializeSMSConnector() first.');
  }

  if (!connectorConfig.sms.enabled) {
    return null;
  }

  const provider = connectorConfig.sms.provider;

  if (provider === 'twilio') {
    const twilioConfig = connectorConfig.sms.providers.twilio;
    if (!twilioConfig) {
      throw new Error('Twilio configuration not found');
    }

    const twilioProvider = new TwilioProvider({
      accountSid: twilioConfig.accountSid,
      authToken: twilioConfig.authToken,
      fromNumber: twilioConfig.fromNumber,
    });

    return new SMSConnector(twilioProvider);
  }

  if (provider === 'messagebird') {
    const messagebirdConfig = connectorConfig.sms.providers.messagebird;
    if (!messagebirdConfig) {
      throw new Error('MessageBird configuration not found');
    }

    const messagebirdProvider = new MessageBirdProvider({
      apiKey: messagebirdConfig.apiKey,
      fromNumber: messagebirdConfig.fromNumber,
    });

    return new SMSConnector(messagebirdProvider);
  }

  throw new Error(`Unsupported SMS provider: ${provider}`);
}

/**
 * Singleton instance (lazy-loaded)
 */
let smsConnectorInstance: SMSConnector | null | undefined;

export function getSMSConnector(): SMSConnector | null {
  if (smsConnectorInstance === undefined) {
    smsConnectorInstance = createSMSConnector();
  }
  return smsConnectorInstance;
}
