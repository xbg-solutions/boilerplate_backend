/**
 * SMS Connector
 * Sends SMS messages for notifications and verification
 */

import { SMSRequest, SMSResult, BulkSMSResult, MessageStatus, DeliveryReport } from './types';
import { logger } from '../logger';

export interface SMSProvider {
  sendMessage(request: SMSRequest): Promise<SMSResult>;
  sendBulk(requests: SMSRequest[]): Promise<BulkSMSResult>;
  getMessageStatus(messageId: string): Promise<MessageStatus>;
  getDeliveryReport(messageId: string): Promise<DeliveryReport>;
}

export class SMSConnector {
  private provider: SMSProvider;

  constructor(provider: SMSProvider) {
    this.provider = provider;
  }

  /**
   * Send SMS message
   */
  async sendMessage(request: SMSRequest): Promise<SMSResult> {
    try {
      logger.info('Sending SMS', {
        to: this.maskPhoneNumber(request.to),
        tags: request.tags,
      });

      const result = await this.provider.sendMessage(request);

      if (result.success) {
        logger.info('SMS sent successfully', {
          messageId: result.messageId,
          cost: result.cost,
        });
      } else {
        logger.error('Failed to send SMS', {
          to: this.maskPhoneNumber(request.to),
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      logger.error('SMS send error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          code: 'SEND_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        provider: 'unknown',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send bulk SMS messages
   */
  async sendBulk(requests: SMSRequest[]): Promise<BulkSMSResult> {
    try {
      logger.info('Sending bulk SMS', {
        count: requests.length,
      });

      const result = await this.provider.sendBulk(requests);

      logger.info('Bulk SMS complete', {
        successful: result.successful,
        failed: result.failed,
        totalCost: result.totalCost,
      });

      return result;
    } catch (error) {
      logger.error('Bulk SMS error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        successful: 0,
        failed: requests.length,
        results: [],
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get message status
   */
  async getMessageStatus(messageId: string): Promise<MessageStatus> {
    return this.provider.getMessageStatus(messageId);
  }

  /**
   * Get delivery report
   */
  async getDeliveryReport(messageId: string): Promise<DeliveryReport> {
    return this.provider.getDeliveryReport(messageId);
  }

  /**
   * Mask phone number for logging (PII protection)
   */
  private maskPhoneNumber(phone: string): string {
    if (phone.length <= 4) return '****';
    return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
  }
}
