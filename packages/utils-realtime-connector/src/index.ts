/**
 * Realtime Connector Barrel Export
 */

export * from './types';
export * from './realtime-connector';
export * from './providers/sse-provider';
export * from './providers/websocket-provider';

import { RealtimeConnector } from './realtime-connector';
import { SSEProvider } from './providers/sse-provider';
import { WebSocketProvider } from './providers/websocket-provider';

// Config is provided via initializeRealtimeConnector() at app startup
let connectorConfig: any = null;

export function initializeRealtimeConnector(config: any): void {
  connectorConfig = config;
  // Reset singleton so it gets re-created with new config
  realtimeConnectorInstance = undefined;
}

export function createRealtimeConnector(): RealtimeConnector | null {
  if (!connectorConfig) {
    throw new Error('Realtime connector not initialized. Call initializeRealtimeConnector() first.');
  }

  if (!connectorConfig.realtime.enabled) {
    return null;
  }

  const provider = connectorConfig.realtime.provider;

  if (provider === 'sse') {
    const config = connectorConfig.realtime.providers.sse;
    return new RealtimeConnector(new SSEProvider(config?.heartbeatInterval));
  }

  if (provider === 'websocket') {
    const config = connectorConfig.realtime.providers.websocket;
    return new RealtimeConnector(
      new WebSocketProvider(config?.port || 8080, config?.path)
    );
  }

  throw new Error(`Unsupported realtime provider: ${provider}`);
}

let realtimeConnectorInstance: RealtimeConnector | null | undefined;

export function getRealtimeConnector(): RealtimeConnector | null {
  if (realtimeConnectorInstance === undefined) {
    realtimeConnectorInstance = createRealtimeConnector();
  }
  return realtimeConnectorInstance;
}
