/**
 * WebSocket Provider
 */

import * as crypto from 'crypto';
import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { RealtimeProvider } from '../realtime-connector';
import { RealtimeMessage, RealtimeClient, BroadcastOptions } from '../types';

/**
 * Security & resource options for the WebSocket server.
 *
 * Without these, a WebSocket endpoint is unauthenticated and any origin can
 * connect and subscribe to any channel (cross-site WebSocket hijacking +
 * cross-user data exposure). Configure `allowedOrigins` and `authenticate`
 * in any deployment that carries per-user/tenant data.
 */
export interface WebSocketProviderOptions {
  /**
   * Allow-list of permitted `Origin` header values. When set, connections from
   * other origins are rejected (mitigates cross-site WebSocket hijacking).
   * When omitted, all origins are accepted and a warning is logged.
   */
  allowedOrigins?: string[];
  /**
   * Authenticate an incoming connection. Receives the upgrade request; return
   * the authenticated userId (string) to accept, or null/throw to reject.
   * Typically verifies a token from the `?token=` query param or a header.
   * When omitted, connections are anonymous (userId undefined).
   */
  authenticate?: (req: IncomingMessage) => Promise<string | null> | string | null;
  /**
   * Authorize a channel subscription for an (already-connected) client.
   * Return true to allow. When set, it is the sole gate on `subscribe`.
   * When omitted, any channel subscription is allowed and a warning is logged.
   */
  authorizeChannel?: (client: RealtimeClient, channel: string) => boolean;
  /** Maximum accepted message size in bytes (default 1 MiB). */
  maxPayload?: number;
  /** Maximum simultaneous connections (default 10000). */
  maxConnections?: number;
}

export class WebSocketProvider implements RealtimeProvider {
  private wss: WebSocketServer;
  private clients: Map<string, { ws: WebSocket; client: RealtimeClient }> = new Map();
  private options: WebSocketProviderOptions;

  constructor(port: number, path = '/ws', options: WebSocketProviderOptions = {}) {
    this.options = options;

    if (!options.allowedOrigins) {
      console.warn(
        '[WebSocketProvider] No allowedOrigins configured — all origins accepted. ' +
        'Set allowedOrigins to prevent cross-site WebSocket hijacking.'
      );
    }
    if (!options.authenticate) {
      console.warn(
        '[WebSocketProvider] No authenticate() configured — connections are anonymous.'
      );
    }
    if (!options.authorizeChannel) {
      console.warn(
        '[WebSocketProvider] No authorizeChannel() configured — clients may subscribe to any channel.'
      );
    }

    this.wss = new WebSocketServer({
      port,
      path,
      maxPayload: options.maxPayload ?? 1024 * 1024,
      verifyClient: (info, done) => {
        // Enforce connection cap.
        if (this.clients.size >= (options.maxConnections ?? 10000)) {
          return done(false, 503, 'Too many connections');
        }
        // Enforce origin allow-list when configured.
        if (options.allowedOrigins) {
          const origin = info.origin || info.req.headers.origin;
          if (!origin || !options.allowedOrigins.includes(origin)) {
            return done(false, 403, 'Origin not allowed');
          }
        }
        return done(true);
      },
    });
    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      // Authenticate before registering the client.
      let userId: string | undefined;
      if (this.options.authenticate) {
        try {
          const result = await this.options.authenticate(req);
          if (!result) {
            ws.close(1008, 'Unauthorized');
            return;
          }
          userId = result;
        } catch {
          ws.close(1008, 'Unauthorized');
          return;
        }
      }

      const clientId = this.generateClientId();
      const client: RealtimeClient = { id: clientId, channels: [], userId };
      this.clients.set(clientId, { ws, client });

      ws.on('message', (data) => this.handleMessage(clientId, data.toString()));
      ws.on('close', () => this.clients.delete(clientId));
      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });
  }

  private handleMessage(clientId: string, data: string): void {
    try {
      const message = JSON.parse(data);
      if (message.type === 'subscribe' && typeof message.channel === 'string') {
        const entry = this.clients.get(clientId);
        if (!entry) return;

        // Authorize the subscription. When an authorizeChannel hook is set it is
        // the sole gate; otherwise (legacy) subscriptions are permitted.
        if (this.options.authorizeChannel && !this.options.authorizeChannel(entry.client, message.channel)) {
          entry.ws.send(JSON.stringify({ type: 'error', error: 'Subscription denied', channel: message.channel }));
          return;
        }

        if (!entry.client.channels.includes(message.channel)) {
          entry.client.channels.push(message.channel);
        }
      }
    } catch {
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
    return `client_${crypto.randomUUID()}`;
  }
}
