/**
 * Email Connector
 * Sends transactional and marketing emails
 */

import {
  TransactionalEmailRequest,
  MarketingEmailRequest,
  BulkEmailRequest,
  EmailResult,
  BulkEmailResult,
  EmailTemplate,
  CreateTemplateRequest,
} from './types';
import { logger } from '../logger';

export interface EmailProvider {
  sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult>;
  sendMarketing(request: MarketingEmailRequest): Promise<EmailResult>;
  sendBulk(request: BulkEmailRequest): Promise<BulkEmailResult>;
  getTemplate(templateId: string): Promise<EmailTemplate>;
  createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate>;
  listTemplates(): Promise<EmailTemplate[]>;
  deleteTemplate(templateId: string): Promise<void>;
}

export class EmailConnector {
  private provider: EmailProvider;

  constructor(provider: EmailProvider) {
    this.provider = provider;
  }

  /**
   * Send transactional email
   */
  async sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult> {
    try {
      logger.info('Sending transactional email', {
        to: request.to.map((r) => r.email),
        subject: request.subject,
        templateId: request.templateId,
      });

      const result = await this.provider.sendTransactional(request);

      if (result.success) {
        logger.info('Email sent successfully', {
          messageId: result.messageId,
          recipients: result.recipients,
        });
      } else {
        logger.error('Failed to send email', {
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      logger.error('Email send error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          code: 'SEND_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send marketing email
   */
  async sendMarketing(request: MarketingEmailRequest): Promise<EmailResult> {
    try {
      logger.info('Sending marketing email', {
        to: request.to.map((r) => r.email),
        campaignId: request.campaignId,
      });

      return await this.provider.sendMarketing(request);
    } catch (error) {
      logger.error('Marketing email error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          code: 'MARKETING_SEND_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send bulk emails
   */
  async sendBulk(request: BulkEmailRequest): Promise<BulkEmailResult> {
    try {
      logger.info('Sending bulk emails', {
        count: request.emails.length,
        batchSize: request.batchSize,
      });

      const result = await this.provider.sendBulk(request);

      logger.info('Bulk email complete', {
        successful: result.successful,
        failed: result.failed,
      });

      return result;
    } catch (error) {
      logger.error('Bulk email error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        successful: 0,
        failed: request.emails.length,
        results: [],
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get email template
   */
  async getTemplate(templateId: string): Promise<EmailTemplate> {
    return this.provider.getTemplate(templateId);
  }

  /**
   * Create email template
   */
  async createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate> {
    logger.info('Creating email template', {
      name: template.name,
    });

    return this.provider.createTemplate(template);
  }

  /**
   * List all email templates
   */
  async listTemplates(): Promise<EmailTemplate[]> {
    return this.provider.listTemplates();
  }

  /**
   * Delete email template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    logger.info('Deleting email template', { templateId });
    return this.provider.deleteTemplate(templateId);
  }
}
