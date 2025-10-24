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
import { COMMUNICATIONS_CONFIG } from '../../config/communications.config';

export function createRealtimeConnector(): RealtimeConnector | null {
  if (!COMMUNICATIONS_CONFIG.realtime.enabled) {
    return null;
  }

  const provider = COMMUNICATIONS_CONFIG.realtime.provider;

  if (provider === 'sse') {
    const config = COMMUNICATIONS_CONFIG.realtime.providers.sse;
    return new RealtimeConnector(new SSEProvider(config?.heartbeatInterval));
  }

  if (provider === 'websocket') {
    const config = COMMUNICATIONS_CONFIG.realtime.providers.websocket;
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
