/**
 * Document Connector Barrel Export
 */

export * from './types';
export * from './document-connector';
export * from './providers/pandadoc-provider';

import { DocumentConnector } from './document-connector';
import { PandaDocProvider } from './providers/pandadoc-provider';

// Config is provided via initializeDocumentConnector() at app startup
let connectorConfig: any = null;

export function initializeDocumentConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  documentConnectorInstance = undefined;
}

export function createDocumentConnector(): DocumentConnector | null {
  if (!connectorConfig) {
    throw new Error('Document connector not initialized. Call initializeDocumentConnector() first.');
  }

  if (!connectorConfig.document.enabled) {
    return null;
  }

  const provider = connectorConfig.document.provider;

  if (provider === 'pandadoc') {
    const config = connectorConfig.document.providers.pandadoc;
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
