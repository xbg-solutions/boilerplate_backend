/**
 * ERP Connector Barrel Export
 */

export * from './types';
export * from './erp-connector';
export * from './providers/workday-provider';

import { ERPConnector } from './erp-connector';
import { WorkdayProvider } from './providers/workday-provider';

// Config is provided via initializeERPConnector() at app startup
let connectorConfig: any = null;

export function initializeERPConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  erpConnectorInstance = undefined;
}

export function createERPConnector(): ERPConnector | null {
  if (!connectorConfig) {
    throw new Error('ERP connector not initialized. Call initializeERPConnector() first.');
  }

  if (!connectorConfig.erp.enabled) {
    return null;
  }

  const provider = connectorConfig.erp.provider;

  if (provider === 'workday') {
    const config = connectorConfig.erp.providers.workday;
    if (!config?.tenant || !config?.clientId || !config?.clientSecret) {
      throw new Error('Workday configuration incomplete');
    }
    return new ERPConnector(new WorkdayProvider({
      tenantName: config.tenant,
      username: config.clientId,
      password: config.clientSecret,
    }));
  }

  throw new Error(`Unsupported ERP provider: ${provider}`);
}

let erpConnectorInstance: ERPConnector | null | undefined;

export function getERPConnector(): ERPConnector | null {
  if (erpConnectorInstance === undefined) {
    erpConnectorInstance = createERPConnector();
  }
  return erpConnectorInstance;
}
