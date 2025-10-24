/**
 * Document Connector Barrel Export
 */

export * from './types';
export * from './document-connector';
export * from './providers/pandadoc-provider';

import { DocumentConnector } from './document-connector';
import { PandaDocProvider } from './providers/pandadoc-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createDocumentConnector(): DocumentConnector | null {
  if (!COMMUNICATIONS_CONFIG.document.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.document.provider;

  if (provider === 'pandadoc') {
    const config = COMMUNICATIONS_CONFIG.document.providers.pandadoc;
    if (!config?.apiKey) {
      throw new Error('PandaDoc API key is required');
    }
    return new DocumentConnector(new PandaDocProvider(config));
  }

  throw new Error(`Unsupported document provider: ${provider}`);
}

let documentConnectorInstance: DocumentConnector | null | undefined;

export function getDocumentConnector(): DocumentConnector | null {
  if (documentConnectorInstance === undefined) {
    documentConnectorInstance = createDocumentConnector();
  }
  return documentConnectorInstance;
}
