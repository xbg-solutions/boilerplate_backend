/**
 * Realtime Connector
 * Manages real-time connections via SSE or WebSocket
 */

import { RealtimeMessage, RealtimeClient, BroadcastOptions } from './types';
import { logger } from '../logger';

export interface RealtimeProvider {
  broadcast(message: RealtimeMessage, options?: BroadcastOptions): Promise<void>;
  sendToClient(clientId: string, message: RealtimeMessage): Promise<void>;
  sendToUser(userId: string, message: RealtimeMessage): Promise<void>;
  sendToChannel(channel: string, message: RealtimeMessage): Promise<void>;
  getConnectedClients(): RealtimeClient[];
  disconnect(clientId: string): Promise<void>;
}

export class RealtimeConnector {
  private provider: RealtimeProvider;

  constructor(provider: RealtimeProvider) {
    this.provider = provider;
  }

  async broadcast(message: RealtimeMessage, options?: BroadcastOptions): Promise<void> {
    logger.info('Broadcasting message', { type: message.type, options });
    return this.provider.broadcast(message, options);
  }

  async sendToClient(clientId: string, message: RealtimeMessage): Promise<void> {
    return this.provider.sendToClient(clientId, message);
  }

  async sendToUser(userId: string, message: RealtimeMessage): Promise<void> {
    return this.provider.sendToUser(userId, message);
  }

  async sendToChannel(channel: string, message: RealtimeMessage): Promise<void> {
    return this.provider.sendToChannel(channel, message);
  }

  getConnectedClients(): RealtimeClient[] {
    return this.provider.getConnectedClients();
  }

  async disconnect(clientId: string): Promise<void> {
    return this.provider.disconnect(clientId);
  }
}
