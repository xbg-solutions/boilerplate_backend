/**
 * Work Management Connector Barrel Export
 */

export * from './types';
export * from './work-mgmt-connector';
export * from './providers/clickup-provider';
export * from './providers/monday-provider';
export * from './providers/notion-provider';

import { WorkManagementConnector } from './work-mgmt-connector';
import { ClickUpProvider } from './providers/clickup-provider';
import { MondayProvider } from './providers/monday-provider';
import { NotionProvider } from './providers/notion-provider';

// Config is provided via initializeWorkManagementConnector() at app startup
let connectorConfig: any = null;

export function initializeWorkManagementConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  workManagementConnectorInstance = undefined;
}

export function createWorkManagementConnector(): WorkManagementConnector | null {
  if (!connectorConfig) {
    throw new Error('Work management connector not initialized. Call initializeWorkManagementConnector() first.');
  }

  if (!connectorConfig.workManagement.enabled) {
    return null;
  }

  const provider = connectorConfig.workManagement.provider;

  if (provider === 'clickup') {
    const config = connectorConfig.workManagement.providers.clickup;
    if (!config?.apiKey) {
      throw new Error('ClickUp API key is required');
    }
    return new WorkManagementConnector(new ClickUpProvider(config));
  }

  if (provider === 'monday') {
    const config = connectorConfig.workManagement.providers.monday;
    if (!config?.apiKey) {
      throw new Error('Monday.com API key is required');
    }
    return new WorkManagementConnector(new MondayProvider(config));
  }

  if (provider === 'notion') {
    const config = connectorConfig.workManagement.providers.notion;
    if (!config?.apiKey) {
      throw new Error('Notion API key is required');
    }
    return new WorkManagementConnector(new NotionProvider(config));
  }

  throw new Error(`Unsupported work management provider: ${provider}`);
}

let workManagementConnectorInstance: WorkManagementConnector | null | undefined;

export function getWorkManagementConnector(): WorkManagementConnector | null {
  if (workManagementConnectorInstance === undefined) {
    workManagementConnectorInstance = createWorkManagementConnector();
  }
  return workManagementConnectorInstance;
}
