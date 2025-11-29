/**
 * ERP Connector Barrel Export
 */

export * from './types';
export * from './erp-connector';
export * from './providers/workday-provider';

import { ERPConnector } from './erp-connector';
import { WorkdayProvider } from './providers/workday-provider';
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createERPConnector(): ERPConnector | null {
  if (!COMMUNICATIONS_CONFIG.erp.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.erp.provider;

  if (provider === 'workday') {
    const config = COMMUNICATIONS_CONFIG.erp.providers.workday;
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
