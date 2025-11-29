/**
 * Realtime Connector - Unit Tests
 *
 * Testing WHAT the realtime connector does, not HOW it works internally:
 * - Broadcasts messages to all clients
 * - Sends messages to specific clients, users, and channels
 * - Retrieves connected clients
 * - Disconnects clients
 * - Provides provider abstraction for SSE and WebSocket implementations
 */

import { RealtimeConnector, RealtimeProvider } from '../realtime-connector';
import { RealtimeMessage, RealtimeClient, BroadcastOptions } from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Realtime Connector', () => {
  let mockProvider: jest.Mocked<RealtimeProvider>;
  let connector: RealtimeConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      broadcast: jest.fn(),
      sendToClient: jest.fn(),
      sendToUser: jest.fn(),
      sendToChannel: jest.fn(),
      getConnectedClients: jest.fn(),
      disconnect: jest.fn(),
    };

    connector = new RealtimeConnector(mockProvider);
  });

  describe('broadcast', () => {
    it('broadcasts message to all clients', async () => {
      const message: RealtimeMessage = {
        id: 'msg-123',
        type: 'notification',
        data: { text: 'Hello everyone' },
        timestamp: new Date(),
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await connector.broadcast(message);

      expect(mockProvider.broadcast).toHaveBeenCalledWith(message, undefined);
    });

    it('broadcasts message with options', async () => {
      const message: RealtimeMessage = {
        id: 'msg-456',
        type: 'update',
        data: { value: 42 },
        timestamp: new Date(),
      };

      const options: BroadcastOptions = {
        channel: 'updates',
        excludeClient: 'client-123',
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await connector.broadcast(message, options);

      expect(mockProvider.broadcast).toHaveBeenCalledWith(message, options);
    });

    it('broadcasts to specific channel', async () => {
      const message: RealtimeMessage = {
        id: 'msg-789',
        type: 'chat',
        data: { message: 'Hello room' },
        timestamp: new Date(),
      };

      const options: BroadcastOptions = {
        channel: 'room-42',
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await connector.broadcast(message, options);

      expect(mockProvider.broadcast).toHaveBeenCalledWith(message, options);
      expect(mockProvider.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat',
        }),
        expect.objectContaining({
          channel: 'room-42',
        })
      );
    });

    it('broadcasts excluding specific client', async () => {
      const message: RealtimeMessage = {
        id: 'msg-abc',
        type: 'presence',
        data: { status: 'online' },
        timestamp: new Date(),
      };

      const options: BroadcastOptions = {
        excludeClient: 'client-sender-123',
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await connector.broadcast(message, options);

      expect(mockProvider.broadcast).toHaveBeenCalledWith(
        message,
        expect.objectContaining({
          excludeClient: 'client-sender-123',
        })
      );
    });

    it('logs broadcast operation', async () => {
      const message: RealtimeMessage = {
        id: 'msg-log',
        type: 'system',
        data: { event: 'maintenance' },
        timestamp: new Date(),
      };

      const options: BroadcastOptions = {
        channel: 'system',
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await connector.broadcast(message, options);

      expect(logger.info).toHaveBeenCalledWith(
        'Broadcasting message',
        expect.objectContaining({
          type: 'system',
          options,
        })
      );
    });

    it('handles broadcast errors', async () => {
      const message: RealtimeMessage = {
        id: 'msg-error',
        type: 'test',
        data: {},
        timestamp: new Date(),
      };

      mockProvider.broadcast.mockRejectedValue(new Error('Network error'));

      await expect(connector.broadcast(message)).rejects.toThrow('Network error');
    });
  });

  describe('sendToClient', () => {
    it('sends message to specific client', async () => {
      const message: RealtimeMessage = {
        id: 'msg-client-1',
        type: 'direct',
        data: { message: 'Hello client' },
        timestamp: new Date(),
      };

      mockProvider.sendToClient.mockResolvedValue(undefined);

      await connector.sendToClient('client-123', message);

      expect(mockProvider.sendToClient).toHaveBeenCalledWith('client-123', message);
    });

    it('sends multiple messages to same client', async () => {
      const message1: RealtimeMessage = {
        id: 'msg-1',
        type: 'update',
        data: { count: 1 },
        timestamp: new Date(),
      };

      const message2: RealtimeMessage = {
        id: 'msg-2',
        type: 'update',
        data: { count: 2 },
        timestamp: new Date(),
      };

      mockProvider.sendToClient.mockResolvedValue(undefined);

      await connector.sendToClient('client-456', message1);
      await connector.sendToClient('client-456', message2);

      expect(mockProvider.sendToClient).toHaveBeenCalledTimes(2);
      expect(mockProvider.sendToClient).toHaveBeenNthCalledWith(1, 'client-456', message1);
      expect(mockProvider.sendToClient).toHaveBeenNthCalledWith(2, 'client-456', message2);
    });

    it('handles client not found errors', async () => {
      const message: RealtimeMessage = {
        id: 'msg-notfound',
        type: 'test',
        data: {},
        timestamp: new Date(),
      };

      mockProvider.sendToClient.mockRejectedValue(new Error('Client not found'));

      await expect(connector.sendToClient('nonexistent', message)).rejects.toThrow(
        'Client not found'
      );
    });
  });

  describe('sendToUser', () => {
    it('sends message to all user connections', async () => {
      const message: RealtimeMessage = {
        id: 'msg-user-1',
        type: 'notification',
        data: { text: 'You have a new message' },
        timestamp: new Date(),
      };

      mockProvider.sendToUser.mockResolvedValue(undefined);

      await connector.sendToUser('user-789', message);

      expect(mockProvider.sendToUser).toHaveBeenCalledWith('user-789', message);
    });

    it('sends to user with multiple devices', async () => {
      const message: RealtimeMessage = {
        id: 'msg-multidevice',
        type: 'sync',
        data: { action: 'refresh' },
        timestamp: new Date(),
      };

      mockProvider.sendToUser.mockResolvedValue(undefined);

      await connector.sendToUser('user-multidevice', message);

      expect(mockProvider.sendToUser).toHaveBeenCalledWith('user-multidevice', message);
    });

    it('handles user offline errors', async () => {
      const message: RealtimeMessage = {
        id: 'msg-offline',
        type: 'test',
        data: {},
        timestamp: new Date(),
      };

      mockProvider.sendToUser.mockRejectedValue(new Error('User offline'));

      await expect(connector.sendToUser('offline-user', message)).rejects.toThrow('User offline');
    });
  });

  describe('sendToChannel', () => {
    it('sends message to channel subscribers', async () => {
      const message: RealtimeMessage = {
        id: 'msg-channel-1',
        type: 'channel-message',
        data: { text: 'Hello channel' },
        timestamp: new Date(),
      };

      mockProvider.sendToChannel.mockResolvedValue(undefined);

      await connector.sendToChannel('general', message);

      expect(mockProvider.sendToChannel).toHaveBeenCalledWith('general', message);
    });

    it('sends to different channels', async () => {
      const message1: RealtimeMessage = {
        id: 'msg-sports',
        type: 'news',
        data: { headline: 'Sports update' },
        timestamp: new Date(),
      };

      const message2: RealtimeMessage = {
        id: 'msg-tech',
        type: 'news',
        data: { headline: 'Tech update' },
        timestamp: new Date(),
      };

      mockProvider.sendToChannel.mockResolvedValue(undefined);

      await connector.sendToChannel('sports', message1);
      await connector.sendToChannel('tech', message2);

      expect(mockProvider.sendToChannel).toHaveBeenCalledTimes(2);
      expect(mockProvider.sendToChannel).toHaveBeenNthCalledWith(1, 'sports', message1);
      expect(mockProvider.sendToChannel).toHaveBeenNthCalledWith(2, 'tech', message2);
    });

    it('handles empty channel errors', async () => {
      const message: RealtimeMessage = {
        id: 'msg-empty',
        type: 'test',
        data: {},
        timestamp: new Date(),
      };

      mockProvider.sendToChannel.mockRejectedValue(new Error('Channel has no subscribers'));

      await expect(connector.sendToChannel('empty-channel', message)).rejects.toThrow(
        'Channel has no subscribers'
      );
    });
  });

  describe('getConnectedClients', () => {
    it('retrieves list of connected clients', () => {
      const clients: RealtimeClient[] = [
        {
          id: 'client-1',
          userId: 'user-1',
          channels: ['general'],
        },
        {
          id: 'client-2',
          userId: 'user-2',
          channels: ['general', 'sports'],
        },
      ];

      mockProvider.getConnectedClients.mockReturnValue(clients);

      const result = connector.getConnectedClients();

      expect(mockProvider.getConnectedClients).toHaveBeenCalled();
      expect(result).toEqual(clients);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no clients connected', () => {
      mockProvider.getConnectedClients.mockReturnValue([]);

      const result = connector.getConnectedClients();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('retrieves clients with metadata', () => {
      const clients: RealtimeClient[] = [
        {
          id: 'client-meta',
          userId: 'user-meta',
          channels: ['updates'],
          metadata: {
            device: 'mobile',
            version: '1.0.0',
          },
        },
      ];

      mockProvider.getConnectedClients.mockReturnValue(clients);

      const result = connector.getConnectedClients();

      expect(result[0].metadata).toEqual({
        device: 'mobile',
        version: '1.0.0',
      });
    });

    it('retrieves clients in multiple channels', () => {
      const clients: RealtimeClient[] = [
        {
          id: 'client-multi',
          userId: 'user-multi',
          channels: ['channel1', 'channel2', 'channel3'],
        },
      ];

      mockProvider.getConnectedClients.mockReturnValue(clients);

      const result = connector.getConnectedClients();

      expect(result[0].channels).toHaveLength(3);
      expect(result[0].channels).toContain('channel1');
      expect(result[0].channels).toContain('channel2');
      expect(result[0].channels).toContain('channel3');
    });
  });

  describe('disconnect', () => {
    it('disconnects specific client', async () => {
      mockProvider.disconnect.mockResolvedValue(undefined);

      await connector.disconnect('client-to-disconnect');

      expect(mockProvider.disconnect).toHaveBeenCalledWith('client-to-disconnect');
    });

    it('disconnects multiple clients sequentially', async () => {
      mockProvider.disconnect.mockResolvedValue(undefined);

      await connector.disconnect('client-1');
      await connector.disconnect('client-2');
      await connector.disconnect('client-3');

      expect(mockProvider.disconnect).toHaveBeenCalledTimes(3);
      expect(mockProvider.disconnect).toHaveBeenNthCalledWith(1, 'client-1');
      expect(mockProvider.disconnect).toHaveBeenNthCalledWith(2, 'client-2');
      expect(mockProvider.disconnect).toHaveBeenNthCalledWith(3, 'client-3');
    });

    it('handles disconnect errors gracefully', async () => {
      mockProvider.disconnect.mockRejectedValue(new Error('Client already disconnected'));

      await expect(connector.disconnect('already-gone')).rejects.toThrow(
        'Client already disconnected'
      );
    });

    it('handles nonexistent client disconnect', async () => {
      mockProvider.disconnect.mockRejectedValue(new Error('Client not found'));

      await expect(connector.disconnect('nonexistent-client')).rejects.toThrow('Client not found');
    });
  });

  describe('message structure validation', () => {
    it('accepts messages with all required fields', async () => {
      const validMessage: RealtimeMessage = {
        id: 'valid-msg',
        type: 'test',
        data: { key: 'value' },
        timestamp: new Date(),
      };

      mockProvider.broadcast.mockResolvedValue(undefined);

      await expect(connector.broadcast(validMessage)).resolves.not.toThrow();
    });

    it('accepts messages with complex data', async () => {
      const complexMessage: RealtimeMessage = {
        id: 'complex-msg',
        type: 'complex',
        data: {
          nested: {
            deeply: {
              value: 'test',
            },
          },
          array: [1, 2, 3],
          mixed: {
            string: 'text',
            number: 42,
            boolean: true,
            null: null,
          },
        },
        timestamp: new Date(),
      };

      mockProvider.sendToClient.mockResolvedValue(undefined);

      await expect(
        connector.sendToClient('client-complex', complexMessage)
      ).resolves.not.toThrow();
    });
  });
});
