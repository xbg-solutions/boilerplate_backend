/**
 * WebSocket Provider
 */

import { WebSocket, WebSocketServer } from 'ws';
import { RealtimeProvider } from '../realtime-connector';
import { RealtimeMessage, RealtimeClient, BroadcastOptions } from '../types';

export class WebSocketProvider implements RealtimeProvider {
  private wss: WebSocketServer;
  private clients: Map<string, { ws: WebSocket; client: RealtimeClient }> = new Map();

  constructor(port: number, path = '/ws') {
    this.wss = new WebSocketServer({ port, path });
    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      const client: RealtimeClient = { id: clientId, channels: [] };
      this.clients.set(clientId, { ws, client });

      ws.on('message', (data) => this.handleMessage(clientId, data.toString()));
      ws.on('close', () => this.clients.delete(clientId));
      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });
  }

  private handleMessage(clientId: string, data: string): void {
    try {
      const message = JSON.parse(data);
      if (message.type === 'subscribe' && message.channel) {
        const entry = this.clients.get(clientId);
        if (entry && !entry.client.channels.includes(message.channel)) {
          entry.client.channels.push(message.channel);
        }
      }
    } catch (error) {
      // Invalid message
    }
  }

  async broadcast(message: RealtimeMessage, options?: BroadcastOptions): Promise<void> {
    const data = JSON.stringify(message);
    for (const [clientId, { ws, client }] of this.clients.entries()) {
      if (options?.excludeClient && clientId === options.excludeClient) continue;
      if (options?.channel && !client.channels.includes(options.channel)) continue;
      if (options?.userId && client.userId !== options.userId) continue;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  async sendToClient(clientId: string, message: RealtimeMessage): Promise<void> {
    const entry = this.clients.get(clientId);
    if (entry && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(message));
    }
  }

  async sendToUser(userId: string, message: RealtimeMessage): Promise<void> {
    const data = JSON.stringify(message);
    for (const { ws, client } of this.clients.values()) {
      if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  async sendToChannel(channel: string, message: RealtimeMessage): Promise<void> {
    const data = JSON.stringify(message);
    for (const { ws, client } of this.clients.values()) {
      if (client.channels.includes(channel) && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  getConnectedClients(): RealtimeClient[] {
    return Array.from(this.clients.values()).map(({ client }) => client);
  }

  async disconnect(clientId: string): Promise<void> {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.ws.close();
      this.clients.delete(clientId);
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
