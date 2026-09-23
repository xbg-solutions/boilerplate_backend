/**
 * SMS Connector Barrel Export
 */

export * from './types';
export * from './sms-connector';
export * from './providers/twilio-provider';
export * from './providers/messagebird-provider';
export * from './providers/sentdm-provider';
export * from './providers/kudosity-provider';

import { SMSConnector } from './sms-connector';
import { TwilioProvider } from './providers/twilio-provider';
import { MessageBirdProvider } from './providers/messagebird-provider';
import { SentDmProvider } from './providers/sentdm-provider';
import { KudosityProvider } from './providers/kudosity-provider';
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

  if (provider === 'messagebird') {
    const messagebirdConfig = COMMUNICATIONS_CONFIG.sms.providers.messagebird;
    if (!messagebirdConfig) {
      throw new Error('MessageBird configuration not found');
    }

    const messagebirdProvider = new MessageBirdProvider({
      apiKey: messagebirdConfig.apiKey,
      fromNumber: messagebirdConfig.fromNumber,
    });

    return new SMSConnector(messagebirdProvider);
  }

  if (provider === 'sentdm') {
    const sentdmConfig = COMMUNICATIONS_CONFIG.sms.providers.sentdm;
    if (!sentdmConfig) {
      throw new Error('Sent configuration not found');
    }

    const sentdmProvider = new SentDmProvider({
      apiKey: sentdmConfig.apiKey,
      baseURL: sentdmConfig.baseURL,
      sandbox: sentdmConfig.sandbox,
    });

    return new SMSConnector(sentdmProvider);
  }

  if (provider === 'kudosity') {
    const kudosityConfig = COMMUNICATIONS_CONFIG.sms.providers.kudosity;
    if (!kudosityConfig) {
      throw new Error('Kudosity configuration not found');
    }

    const kudosityProvider = new KudosityProvider({
      apiKey: kudosityConfig.apiKey,
      fromNumber: kudosityConfig.fromNumber,
      baseURL: kudosityConfig.baseURL,
      trackLinks: kudosityConfig.trackLinks,
    });

    return new SMSConnector(kudosityProvider);
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
