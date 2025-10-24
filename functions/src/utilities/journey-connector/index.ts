/**
 * Journey Connector Barrel Export
 */

export * from './types';
export * from './journey-connector';
export * from './providers/ortto-provider';

import { JourneyConnector } from './journey-connector';
import { OrttoProvider } from './providers/ortto-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createJourneyConnector(): JourneyConnector | null {
  if (!COMMUNICATIONS_CONFIG.journey.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.journey.provider;

  if (provider === 'ortto') {
    const config = COMMUNICATIONS_CONFIG.journey.providers.ortto;
    if (!config?.apiKey) {
      throw new Error('Ortto API key is required');
    }
    return new JourneyConnector(new OrttoProvider(config));
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
