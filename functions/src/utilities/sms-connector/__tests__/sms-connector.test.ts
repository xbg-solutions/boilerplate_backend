/**
 * SMS Connector - Unit Tests
 *
 * Testing WHAT the SMS connector does, not HOW it works internally:
 * - Sends SMS messages through providers
 * - Sends bulk SMS messages
 * - Handles success and error cases
 * - Masks phone numbers for PII protection
 * - Retrieves message status and delivery reports
 */

import { SMSConnector, SMSProvider } from '../sms-connector';
import { SMSRequest, SMSResult, BulkSMSResult, MessageStatus, DeliveryReport } from '../types';
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

describe('SMS Connector', () => {
  let mockProvider: jest.Mocked<SMSProvider>;
  let connector: SMSConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock provider
    mockProvider = {
      sendMessage: jest.fn(),
      sendBulk: jest.fn(),
      getMessageStatus: jest.fn(),
      getDeliveryReport: jest.fn(),
    };

    connector = new SMSConnector(mockProvider);
  });

  describe('sendMessage', () => {
    it('sends SMS successfully through provider', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
        tags: ['verification'],
      };

      const expectedResult: SMSResult = {
        success: true,
        messageId: 'msg-123',
        cost: 0.05,
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(expectedResult);

      const result = await connector.sendMessage(request);

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(request);
      expect(result).toEqual(expectedResult);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('logs successful SMS send', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-123',
        cost: 0.05,
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Sending SMS',
        expect.objectContaining({
          to: expect.stringContaining('****'),
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'SMS sent successfully',
        expect.objectContaining({
          messageId: 'msg-123',
          cost: 0.05,
        })
      );
    });

    it('handles SMS send failure from provider', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
      };

      const failedResult: SMSResult = {
        success: false,
        error: {
          code: 'INVALID_NUMBER',
          message: 'Phone number is invalid',
        },
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(failedResult);

      const result = await connector.sendMessage(request);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_NUMBER');
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to send SMS',
        expect.objectContaining({
          errorCode: 'INVALID_NUMBER',
          errorMessage: 'Phone number is invalid',
        })
      );
    });

    it('handles provider errors gracefully', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
      };

      mockProvider.sendMessage.mockRejectedValue(new Error('Network timeout'));

      const result = await connector.sendMessage(request);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SEND_ERROR');
      expect(result.error?.message).toBe('Network timeout');
      expect(logger.error).toHaveBeenCalled();
    });

    it('handles non-Error exceptions', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
      };

      mockProvider.sendMessage.mockRejectedValue('String error');

      const result = await connector.sendMessage(request);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SEND_ERROR');
      expect(result.error?.message).toBe('Unknown error');
    });

    it('sends SMS with media URLs', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Check out this image',
        mediaUrls: ['https://example.com/image.jpg'],
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-456',
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaUrls: ['https://example.com/image.jpg'],
        })
      );
    });

    it('sends SMS with custom from number', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
        from: '+61400000000',
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-789',
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '+61400000000',
        })
      );
    });

    it('sends SMS with validity period', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Expires soon',
        validityPeriod: 300, // 5 minutes
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-abc',
        provider: 'messagebird',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          validityPeriod: 300,
        })
      );
    });

    it('sends SMS with metadata', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
        metadata: {
          userId: 'user-123',
          campaignId: 'camp-456',
        },
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-def',
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            userId: 'user-123',
            campaignId: 'camp-456',
          },
        })
      );
    });

    it('masks phone number in logs', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test message',
      };

      const result: SMSResult = {
        success: true,
        messageId: 'msg-123',
        provider: 'twilio',
        timestamp: new Date(),
      };

      mockProvider.sendMessage.mockResolvedValue(result);

      await connector.sendMessage(request);

      const logCalls = (logger.info as jest.Mock).mock.calls;
      const logArgsString = JSON.stringify(logCalls);

      // Should not contain full phone number
      expect(logArgsString).not.toContain('+61412345678');
      // Should contain masked version
      expect(logArgsString).toContain('5678');
    });
  });

  describe('sendBulk', () => {
    it('sends bulk SMS successfully', async () => {
      const requests: SMSRequest[] = [
        { to: '+61412345678', message: 'Message 1' },
        { to: '+61498765432', message: 'Message 2' },
        { to: '+61423456789', message: 'Message 3' },
      ];

      const bulkResult: BulkSMSResult = {
        success: true,
        successful: 3,
        failed: 0,
        results: [
          {
            success: true,
            messageId: 'msg-1',
            cost: 0.05,
            provider: 'twilio',
            timestamp: new Date(),
          },
          {
            success: true,
            messageId: 'msg-2',
            cost: 0.05,
            provider: 'twilio',
            timestamp: new Date(),
          },
          {
            success: true,
            messageId: 'msg-3',
            cost: 0.05,
            provider: 'twilio',
            timestamp: new Date(),
          },
        ],
        totalCost: 0.15,
        timestamp: new Date(),
      };

      mockProvider.sendBulk.mockResolvedValue(bulkResult);

      const result = await connector.sendBulk(requests);

      expect(mockProvider.sendBulk).toHaveBeenCalledWith(requests);
      expect(result.success).toBe(true);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.totalCost).toBe(0.15);
    });

    it('logs bulk SMS send operation', async () => {
      const requests: SMSRequest[] = [
        { to: '+61412345678', message: 'Message 1' },
        { to: '+61498765432', message: 'Message 2' },
      ];

      const bulkResult: BulkSMSResult = {
        success: true,
        successful: 2,
        failed: 0,
        results: [],
        totalCost: 0.10,
        timestamp: new Date(),
      };

      mockProvider.sendBulk.mockResolvedValue(bulkResult);

      await connector.sendBulk(requests);

      expect(logger.info).toHaveBeenCalledWith(
        'Sending bulk SMS',
        expect.objectContaining({
          count: 2,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Bulk SMS complete',
        expect.objectContaining({
          successful: 2,
          failed: 0,
          totalCost: 0.10,
        })
      );
    });

    it('handles partial bulk send failures', async () => {
      const requests: SMSRequest[] = [
        { to: '+61412345678', message: 'Message 1' },
        { to: '+61498765432', message: 'Message 2' },
        { to: 'invalid', message: 'Message 3' },
      ];

      const bulkResult: BulkSMSResult = {
        success: true,
        successful: 2,
        failed: 1,
        results: [
          {
            success: true,
            messageId: 'msg-1',
            provider: 'twilio',
            timestamp: new Date(),
          },
          {
            success: true,
            messageId: 'msg-2',
            provider: 'twilio',
            timestamp: new Date(),
          },
          {
            success: false,
            error: {
              code: 'INVALID_NUMBER',
              message: 'Invalid phone number',
            },
            provider: 'twilio',
            timestamp: new Date(),
          },
        ],
        timestamp: new Date(),
      };

      mockProvider.sendBulk.mockResolvedValue(bulkResult);

      const result = await connector.sendBulk(requests);

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('handles bulk send errors', async () => {
      const requests: SMSRequest[] = [
        { to: '+61412345678', message: 'Message 1' },
        { to: '+61498765432', message: 'Message 2' },
      ];

      mockProvider.sendBulk.mockRejectedValue(new Error('Bulk send failed'));

      const result = await connector.sendBulk(requests);

      expect(result.success).toBe(false);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(2);
      expect(logger.error).toHaveBeenCalled();
    });

    it('handles non-Error exceptions in bulk send', async () => {
      const requests: SMSRequest[] = [
        { to: '+61412345678', message: 'Message 1' },
      ];

      mockProvider.sendBulk.mockRejectedValue('Unknown error type');

      const result = await connector.sendBulk(requests);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
    });

    it('handles empty bulk requests', async () => {
      const requests: SMSRequest[] = [];

      const bulkResult: BulkSMSResult = {
        success: true,
        successful: 0,
        failed: 0,
        results: [],
        timestamp: new Date(),
      };

      mockProvider.sendBulk.mockResolvedValue(bulkResult);

      const result = await connector.sendBulk(requests);

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('getMessageStatus', () => {
    it('retrieves message status successfully', async () => {
      const expectedStatus: MessageStatus = {
        messageId: 'msg-123',
        status: 'delivered',
        to: '+61412345678',
        from: '+61400000000',
        body: 'Test message',
        timestamp: new Date(),
      };

      mockProvider.getMessageStatus.mockResolvedValue(expectedStatus);

      const status = await connector.getMessageStatus('msg-123');

      expect(mockProvider.getMessageStatus).toHaveBeenCalledWith('msg-123');
      expect(status.messageId).toBe('msg-123');
      expect(status.status).toBe('delivered');
    });

    it('retrieves failed message status', async () => {
      const expectedStatus: MessageStatus = {
        messageId: 'msg-456',
        status: 'failed',
        to: '+61412345678',
        from: '+61400000000',
        body: 'Test message',
        errorCode: '30008',
        errorMessage: 'Unknown destination handset',
        timestamp: new Date(),
      };

      mockProvider.getMessageStatus.mockResolvedValue(expectedStatus);

      const status = await connector.getMessageStatus('msg-456');

      expect(status.status).toBe('failed');
      expect(status.errorCode).toBe('30008');
      expect(status.errorMessage).toBe('Unknown destination handset');
    });

    it('retrieves queued message status', async () => {
      const expectedStatus: MessageStatus = {
        messageId: 'msg-789',
        status: 'queued',
        to: '+61412345678',
        from: '+61400000000',
        body: 'Test message',
        timestamp: new Date(),
      };

      mockProvider.getMessageStatus.mockResolvedValue(expectedStatus);

      const status = await connector.getMessageStatus('msg-789');

      expect(status.status).toBe('queued');
    });
  });

  describe('getDeliveryReport', () => {
    it('retrieves delivery report for delivered message', async () => {
      const expectedReport: DeliveryReport = {
        messageId: 'msg-123',
        delivered: true,
        deliveredAt: new Date('2024-01-01T12:00:00Z'),
      };

      mockProvider.getDeliveryReport.mockResolvedValue(expectedReport);

      const report = await connector.getDeliveryReport('msg-123');

      expect(mockProvider.getDeliveryReport).toHaveBeenCalledWith('msg-123');
      expect(report.delivered).toBe(true);
      expect(report.deliveredAt).toBeDefined();
    });

    it('retrieves delivery report for undelivered message', async () => {
      const expectedReport: DeliveryReport = {
        messageId: 'msg-456',
        delivered: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Message could not be delivered',
      };

      mockProvider.getDeliveryReport.mockResolvedValue(expectedReport);

      const report = await connector.getDeliveryReport('msg-456');

      expect(report.delivered).toBe(false);
      expect(report.errorCode).toBe('NETWORK_ERROR');
      expect(report.errorMessage).toBe('Message could not be delivered');
    });
  });

  describe('phone number masking', () => {
    it('masks standard phone numbers', async () => {
      const request: SMSRequest = {
        to: '+61412345678',
        message: 'Test',
      };

      mockProvider.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-1',
        provider: 'test',
        timestamp: new Date(),
      });

      await connector.sendMessage(request);

      const firstInfoCall = (logger.info as jest.Mock).mock.calls[0];
      expect(firstInfoCall[1].to).toMatch(/\*+5678$/);
      expect(firstInfoCall[1].to).not.toContain('+61412345678');
    });

    it('masks short phone numbers', async () => {
      const request: SMSRequest = {
        to: '1234',
        message: 'Test',
      };

      mockProvider.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-1',
        provider: 'test',
        timestamp: new Date(),
      });

      await connector.sendMessage(request);

      const firstInfoCall = (logger.info as jest.Mock).mock.calls[0];
      // Short numbers should just be masked as ****
      expect(firstInfoCall[1].to).toBe('****');
    });

    it('masks very short phone numbers', async () => {
      const request: SMSRequest = {
        to: '123',
        message: 'Test',
      };

      mockProvider.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-1',
        provider: 'test',
        timestamp: new Date(),
      });

      await connector.sendMessage(request);

      const firstInfoCall = (logger.info as jest.Mock).mock.calls[0];
      expect(firstInfoCall[1].to).toBe('****');
    });
  });
});
