/**
 * SMS Connector Barrel Export
 */

export * from './types';
export * from './sms-connector';
export * from './providers/twilio-provider';

import { SMSConnector } from './sms-connector';
import { TwilioProvider } from './providers/twilio-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

/**
 * Factory function to create SMS connector with configuration
 */
export function createSMSConnector(): SMSConnector | null {
  if (!COMMUNICATIONS_CONFIG.sms.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.sms.provider;

  if (provider === 'twilio') {
    const twilioConfig = COMMUNICATIONS_CONFIG.sms.providers.twilio;
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
