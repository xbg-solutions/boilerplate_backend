/**
 * CRM Connector Barrel Export
 */

export * from './types';
export * from './crm-connector';
export * from './providers/hubspot-provider';

import { CRMConnector } from './crm-connector';
import { HubSpotProvider } from './providers/hubspot-provider';

// Config is provided via initializeCRMConnector() at app startup
let connectorConfig: any = null;

export function initializeCRMConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  crmConnectorInstance = undefined;
}

/**
 * Factory function to create CRM connector with configuration
 */
export function createCRMConnector(): CRMConnector | null {
  if (!connectorConfig) {
    throw new Error('CRM connector not initialized. Call initializeCRMConnector() first.');
  }

  if (!connectorConfig.crm.enabled) {
    return null;
  }

  const provider = connectorConfig.crm.provider;

  if (provider === 'hubspot') {
    const hubspotConfig = connectorConfig.crm.providers.hubspot;
    if (!hubspotConfig) {
      throw new Error('HubSpot configuration not found');
    }

    const hubspotProvider = new HubSpotProvider(hubspotConfig.apiKey);
    return new CRMConnector(hubspotProvider);
  }

  if (provider === 'salesforce') {
    // Salesforce implementation would go here
    throw new Error('Salesforce provider not yet implemented');
  }

  if (provider === 'attio') {
    // Attio implementation would go here
    throw new Error('Attio provider not yet implemented');
  }

  throw new Error(`Unsupported CRM provider: ${provider}`);
}

/**
 * Singleton instance (lazy-loaded)
 */
let crmConnectorInstance: CRMConnector | null | undefined;

export function getCRMConnector(): CRMConnector | null {
  if (crmConnectorInstance === undefined) {
    crmConnectorInstance = createCRMConnector();
  }
  return crmConnectorInstance;
}
