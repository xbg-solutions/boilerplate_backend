/**
 * Email Connector Barrel Export
 */

export * from './types';
export * from './email-connector';
export * from './providers/mailjet-provider';
export * from './providers/ortto-provider';

import { EmailConnector } from './email-connector';
import { MailjetProvider } from './providers/mailjet-provider';
import { OrttoEmailProvider } from './providers/ortto-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

/**
 * Factory function to create email connector with configuration
 */
export function createEmailConnector(): EmailConnector | null {
  if (!COMMUNICATIONS_CONFIG.email.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.email.provider;

  if (provider === 'mailjet') {
    const mailjetConfig = COMMUNICATIONS_CONFIG.email.providers.mailjet;
    if (!mailjetConfig) {
      throw new Error('Mailjet configuration not found');
    }

    const mailjetProvider = new MailjetProvider({
      apiKey: mailjetConfig.apiKey,
      secretKey: mailjetConfig.secretKey,
      fromEmail: COMMUNICATIONS_CONFIG.email.fromAddress,
      fromName: COMMUNICATIONS_CONFIG.email.fromName,
    });

    return new EmailConnector(mailjetProvider);
  }

  if (provider === 'ortto') {
    const orttoConfig = COMMUNICATIONS_CONFIG.email.providers.ortto;
    if (!orttoConfig) {
      throw new Error('Ortto configuration not found');
    }

    const orttoProvider = new OrttoEmailProvider({
      apiKey: orttoConfig.apiKey,
      region: orttoConfig.region,
      fromEmail: COMMUNICATIONS_CONFIG.email.fromAddress,
      fromName: COMMUNICATIONS_CONFIG.email.fromName,
    });

    return new EmailConnector(orttoProvider);
  }

  throw new Error(`Unsupported email provider: ${provider}`);
}

/**
 * Singleton instance (lazy-loaded)
 */
let emailConnectorInstance: EmailConnector | null | undefined;

export function getEmailConnector(): EmailConnector | null {
  if (emailConnectorInstance === undefined) {
    emailConnectorInstance = createEmailConnector();
  }
  return emailConnectorInstance;
}
