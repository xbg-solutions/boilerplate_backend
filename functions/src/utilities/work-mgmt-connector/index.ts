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
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createWorkManagementConnector(): WorkManagementConnector | null {
  if (!COMMUNICATIONS_CONFIG.workManagement.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.workManagement.provider;

  if (provider === 'clickup') {
    const config = COMMUNICATIONS_CONFIG.workManagement.providers.clickup;
    if (!config?.apiKey) {
      throw new Error('ClickUp API key is required');
    }
    return new WorkManagementConnector(new ClickUpProvider(config));
  }

  if (provider === 'monday') {
    const config = COMMUNICATIONS_CONFIG.workManagement.providers.monday;
    if (!config?.apiKey) {
      throw new Error('Monday.com API key is required');
    }
    return new WorkManagementConnector(new MondayProvider(config));
  }

  if (provider === 'notion') {
    const config = COMMUNICATIONS_CONFIG.workManagement.providers.notion;
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
