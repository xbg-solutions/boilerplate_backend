/**
 * MessageBird SMS Provider
 * Implementation using MessageBird API
 */

import messagebird from 'messagebird';
import { SMSProvider } from '../sms-connector';
import { SMSRequest, SMSResult, BulkSMSResult, MessageStatus, DeliveryReport } from '../types';

export interface MessageBirdConfig {
  apiKey: string;
  fromNumber: string;
}

export class MessageBirdProvider implements SMSProvider {
  private client: any;
  private config: MessageBirdConfig;

  constructor(config: MessageBirdConfig) {
    this.config = config;
    this.client = messagebird(config.apiKey);
  }

  /**
   * Send SMS message
   */
  async sendMessage(request: SMSRequest): Promise<SMSResult> {
    try {
      const params: any = {
        originator: request.from || this.config.fromNumber,
        recipients: [request.to],
        body: request.message,
      };

      // Add validity period (in seconds)
      if (request.validityPeriod) {
        params.validity = request.validityPeriod;
      }

      // Add reference if provided in metadata
      if (request.metadata?.reference) {
        params.reference = request.metadata.reference;
      }

      const result = await new Promise<any>((resolve, reject) => {
        this.client.messages.create(params, (err: any, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });

      return {
        success: true,
        messageId: result.id,
        provider: 'messagebird',
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code?.toString() || 'MESSAGEBIRD_ERROR',
          message: error.message || 'Unknown MessageBird error',
          details: error.errors || error,
        },
        provider: 'messagebird',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send bulk SMS messages
   */
  async sendBulk(requests: SMSRequest[]): Promise<BulkSMSResult> {
    const results: SMSResult[] = [];
    let successful = 0;
    let failed = 0;
    let totalCost = 0;

    // MessageBird supports batch sending, but we'll process sequentially for consistency
    for (const request of requests) {
      const result = await this.sendMessage(request);
      results.push(result);

      if (result.success) {
        successful++;
        if (result.cost) {
          totalCost += result.cost;
        }
      } else {
        failed++;
      }

      // Rate limiting: small delay between messages
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      success: failed === 0,
      successful,
      failed,
      results,
      totalCost,
      timestamp: new Date(),
    };
  }

  /**
   * Get message status
   */
  async getMessageStatus(messageId: string): Promise<MessageStatus> {
    try {
      const message = await new Promise<any>((resolve, reject) => {
        this.client.messages.read(messageId, (err: any, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });

      return {
        messageId: message.id,
        status: this.mapMessageBirdStatus(message.status),
        to: message.recipients.msisdn || '',
        from: message.originator,
        body: message.body,
        errorCode: message.recipients?.statusReason?.toString(),
        errorMessage: undefined,
        timestamp: new Date(message.createdDatetime),
      };
    } catch (error: any) {
      throw new Error(`Failed to get message status: ${error.message}`);
    }
  }

  /**
   * Get delivery report
   */
  async getDeliveryReport(messageId: string): Promise<DeliveryReport> {
    try {
      const message = await new Promise<any>((resolve, reject) => {
        this.client.messages.read(messageId, (err: any, response: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });

      const recipient = message.recipients?.items?.[0];
      const delivered = recipient?.status === 'delivered';

      return {
        messageId: message.id,
        delivered,
        deliveredAt: delivered && recipient?.statusDatetime
          ? new Date(recipient.statusDatetime)
          : undefined,
        errorCode: recipient?.statusReason?.toString(),
        errorMessage: undefined,
      };
    } catch (error: any) {
      throw new Error(`Failed to get delivery report: ${error.message}`);
    }
  }

  /**
   * Map MessageBird status to standard status
   */
  private mapMessageBirdStatus(
    messagebirdStatus: string
  ): 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered' {
    const statusMap: Record<string, any> = {
      scheduled: 'queued',
      buffered: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      expired: 'failed',
      delivery_failed: 'undelivered',
    };

    return statusMap[messagebirdStatus] || 'failed';
  }
}
