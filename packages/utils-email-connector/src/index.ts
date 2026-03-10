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

// Config is provided via initializeEmailConnector() at app startup
let connectorConfig: any = null;

export function initializeEmailConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  emailConnectorInstance = undefined;
}

/**
 * Factory function to create email connector with configuration
 */
export function createEmailConnector(): EmailConnector | null {
  if (!connectorConfig) {
    throw new Error('Email connector not initialized. Call initializeEmailConnector() first.');
  }

  if (!connectorConfig.email.enabled) {
    return null;
  }

  const provider = connectorConfig.email.provider;

  if (provider === 'mailjet') {
    const mailjetConfig = connectorConfig.email.providers.mailjet;
    if (!mailjetConfig) {
      throw new Error('Mailjet configuration not found');
    }

    const mailjetProvider = new MailjetProvider({
      apiKey: mailjetConfig.apiKey,
      secretKey: mailjetConfig.secretKey,
      fromEmail: connectorConfig.email.fromAddress,
      fromName: connectorConfig.email.fromName,
    });

    return new EmailConnector(mailjetProvider);
  }

  if (provider === 'ortto') {
    const orttoConfig = connectorConfig.email.providers.ortto;
    if (!orttoConfig) {
      throw new Error('Ortto configuration not found');
    }

    const orttoProvider = new OrttoEmailProvider({
      apiKey: orttoConfig.apiKey,
      region: orttoConfig.region as 'us' | 'au' | 'eu' | undefined,
      fromEmail: connectorConfig.email.fromAddress,
      fromName: connectorConfig.email.fromName,
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
