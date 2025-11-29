/**
 * SSE (Server-Sent Events) Provider
 */

import { Response } from 'express';
import { RealtimeProvider } from '../realtime-connector';
import { RealtimeMessage, RealtimeClient, BroadcastOptions } from '../types';

export class SSEProvider implements RealtimeProvider {
  private clients: Map<string, { res: Response; client: RealtimeClient }> = new Map();
  private heartbeatInterval: number;

  constructor(heartbeatInterval = 30000) {
    this.heartbeatInterval = heartbeatInterval;
    this.startHeartbeat();
  }

  addClient(clientId: string, res: Response, client: RealtimeClient): void {
    this.clients.set(clientId, { res, client });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  }

  async broadcast(message: RealtimeMessage, options?: BroadcastOptions): Promise<void> {
    const formatted = this.formatSSE(message);
    for (const [clientId, { res, client }] of this.clients.entries()) {
      if (options?.excludeClient && clientId === options.excludeClient) continue;
      if (options?.channel && !client.channels.includes(options.channel)) continue;
      if (options?.userId && client.userId !== options.userId) continue;
      res.write(formatted);
    }
  }

  async sendToClient(clientId: string, message: RealtimeMessage): Promise<void> {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.res.write(this.formatSSE(message));
    }
  }

  async sendToUser(userId: string, message: RealtimeMessage): Promise<void> {
    const formatted = this.formatSSE(message);
    for (const { res, client } of this.clients.values()) {
      if (client.userId === userId) {
        res.write(formatted);
      }
    }
  }

  async sendToChannel(channel: string, message: RealtimeMessage): Promise<void> {
    const formatted = this.formatSSE(message);
    for (const { res, client } of this.clients.values()) {
      if (client.channels.includes(channel)) {
        res.write(formatted);
      }
    }
  }

  getConnectedClients(): RealtimeClient[] {
    return Array.from(this.clients.values()).map(({ client }) => client);
  }

  async disconnect(clientId: string): Promise<void> {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.res.end();
      this.clients.delete(clientId);
    }
  }

  private formatSSE(message: RealtimeMessage): string {
    return `id: ${message.id}\nevent: ${message.type}\ndata: ${JSON.stringify(message.data)}\n\n`;
  }

  private startHeartbeat(): void {
    setInterval(() => {
      for (const { res } of this.clients.values()) {
        res.write(':heartbeat\n\n');
      }
    }, this.heartbeatInterval);
  }
}
