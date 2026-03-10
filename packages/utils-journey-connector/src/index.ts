/**
 * Journey Connector Barrel Export
 */

export * from './types';
export * from './journey-connector';
export * from './providers/ortto-provider';

import { JourneyConnector } from './journey-connector';
import { OrttoProvider } from './providers/ortto-provider';

// Config is provided via initializeJourneyConnector() at app startup
let connectorConfig: any = null;

export function initializeJourneyConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  journeyConnectorInstance = undefined;
}

export function createJourneyConnector(): JourneyConnector | null {
  if (!connectorConfig) {
    throw new Error('Journey connector not initialized. Call initializeJourneyConnector() first.');
  }

  if (!connectorConfig.journey.enabled) {
    return null;
  }

  const provider = connectorConfig.journey.provider;

  if (provider === 'ortto') {
    const config = connectorConfig.journey.providers.ortto;
    if (!config?.apiKey) {
      throw new Error('Ortto API key is required');
    }
    return new JourneyConnector(new OrttoProvider({
      ...config,
      region: config.region as 'us' | 'au' | 'eu' | undefined,
    }));
  }

  throw new Error(`Unsupported journey provider: ${provider}`);
}

let journeyConnectorInstance: JourneyConnector | null | undefined;

export function getJourneyConnector(): JourneyConnector | null {
  if (journeyConnectorInstance === undefined) {
    journeyConnectorInstance = createJourneyConnector();
  }
  return journeyConnectorInstance;
}
