/**
 * Twilio SMS Provider
 * Implementation using Twilio API
 */

import { Twilio } from 'twilio';
import { SMSProvider } from '../sms-connector';
import { SMSRequest, SMSResult, BulkSMSResult, MessageStatus, DeliveryReport } from '../types';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export class TwilioProvider implements SMSProvider {
  private client: Twilio;
  private config: TwilioConfig;

  constructor(config: TwilioConfig) {
    this.config = config;
    this.client = new Twilio(config.accountSid, config.authToken);
  }

  /**
   * Send SMS message
   */
  async sendMessage(request: SMSRequest): Promise<SMSResult> {
    try {
      const message = await this.client.messages.create({
        body: request.message,
        from: request.from || this.config.fromNumber,
        to: request.to,
        mediaUrl: request.mediaUrls,
        validityPeriod: request.validityPeriod,
        statusCallback: request.metadata?.statusCallback,
      });

      return {
        success: true,
        messageId: message.sid,
        cost: message.price ? Math.abs(parseFloat(message.price)) : undefined,
        provider: 'twilio',
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code?.toString() || 'TWILIO_ERROR',
          message: error.message || 'Unknown Twilio error',
          details: {
            status: error.status,
            moreInfo: error.moreInfo,
          },
        },
        provider: 'twilio',
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

    // Twilio doesn't have native batch send, so we send sequentially with rate limiting
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
    const message = await this.client.messages(messageId).fetch();

    return {
      messageId: message.sid,
      status: this.mapTwilioStatus(message.status),
      to: message.to,
      from: message.from,
      body: message.body,
      errorCode: message.errorCode?.toString(),
      errorMessage: message.errorMessage || undefined,
      timestamp: message.dateCreated,
    };
  }

  /**
   * Get delivery report
   */
  async getDeliveryReport(messageId: string): Promise<DeliveryReport> {
    const message = await this.client.messages(messageId).fetch();

    return {
      messageId: message.sid,
      delivered: message.status === 'delivered',
      deliveredAt: message.dateSent || undefined,
      errorCode: message.errorCode?.toString(),
      errorMessage: message.errorMessage || undefined,
    };
  }

  /**
   * Map Twilio status to standard status
   */
  private mapTwilioStatus(
    twilioStatus: string
  ): 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered' {
    const statusMap: Record<string, any> = {
      queued: 'queued',
      sending: 'sending',
      sent: 'sent',
      delivered: 'delivered',
      failed: 'failed',
      undelivered: 'undelivered',
    };

    return statusMap[twilioStatus] || 'failed';
  }
}
