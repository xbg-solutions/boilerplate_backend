/**
 * SNS Connector Barrel Export
 */

export * from './types';
export * from './sns-connector';
export * from './providers/aws-sns-provider';

import { SNSConnector } from './sns-connector';
import { AWSSNSProvider } from './providers/aws-sns-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

/**
 * Factory function to create SNS connector with configuration
 */
export function createSNSConnector(): SNSConnector | null {
  if (!COMMUNICATIONS_CONFIG.sns.enabled) {
    return null;
  }

  const provider = new AWSSNSProvider({
    region: COMMUNICATIONS_CONFIG.sns.region,
    accessKeyId: COMMUNICATIONS_CONFIG.sns.accessKeyId!,
    secretAccessKey: COMMUNICATIONS_CONFIG.sns.secretAccessKey!,
  });

  return new SNSConnector(provider);
}

/**
 * Singleton instance (lazy-loaded)
 */
let snsConnectorInstance: SNSConnector | null | undefined;

export function getSNSConnector(): SNSConnector | null {
  if (snsConnectorInstance === undefined) {
    snsConnectorInstance = createSNSConnector();
  }
  return snsConnectorInstance;
}
