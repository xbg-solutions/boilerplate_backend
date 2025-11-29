/**
 * Mailjet Email Provider
 * Implementation using Mailjet API
 */

import Mailjet from 'node-mailjet';
import type { Client } from 'node-mailjet';
import { EmailProvider } from '../email-connector';
import {
  TransactionalEmailRequest,
  MarketingEmailRequest,
  BulkEmailRequest,
  EmailResult,
  BulkEmailResult,
  EmailTemplate,
  CreateTemplateRequest,
} from '../types';

export interface MailjetConfig {
  apiKey: string;
  secretKey: string;
  fromEmail: string;
  fromName: string;
}

export class MailjetProvider implements EmailProvider {
  private client: Client;
  private config: MailjetConfig;

  constructor(config: MailjetConfig) {
    this.config = config;
    this.client = Mailjet.apiConnect(config.apiKey, config.secretKey);
  }

  /**
   * Send transactional email
   */
  async sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult> {
    try {
      const message: any = {
        From: {
          Email: this.config.fromEmail,
          Name: this.config.fromName,
        },
        To: request.to.map((recipient) => ({
          Email: recipient.email,
          Name: recipient.name,
          Variables: recipient.variables,
        })),
        Subject: request.subject,
        ReplyTo: request.replyTo ? { Email: request.replyTo } : undefined,
      };

      // Use template or raw content
      if (request.templateId) {
        message.TemplateID = parseInt(request.templateId, 10);
        message.TemplateLanguage = true;
        message.Variables = request.variables || {};
      } else {
        message.HTMLPart = request.htmlContent;
        message.TextPart = request.textContent;
      }

      // Add attachments
      if (request.attachments && request.attachments.length > 0) {
        message.Attachments = request.attachments.map((att) => ({
          Filename: att.filename,
          ContentType: att.contentType || 'application/octet-stream',
          Base64Content: Buffer.isBuffer(att.content)
            ? att.content.toString('base64')
            : Buffer.from(att.content).toString('base64'),
        }));
      }

      // Add custom headers for tags
      if (request.tags && request.tags.length > 0) {
        message.CustomCampaign = request.tags.join(',');
      }

      const result = await this.client.post('send', { version: 'v3.1' }).request({
        Messages: [message],
      });

      const data = result.body as any;

      return {
        success: true,
        messageId: data.Messages?.[0]?.To?.[0]?.MessageID?.toString(),
        recipients: request.to.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.statusCode?.toString() || 'MAILJET_ERROR',
          message: error.message || 'Unknown Mailjet error',
          details: error.response?.body,
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send marketing email
   */
  async sendMarketing(request: MarketingEmailRequest): Promise<EmailResult> {
    // Marketing emails use the same Mailjet API with campaign tracking
    return this.sendTransactional(request);
  }

  /**
   * Send bulk emails
   */
  async sendBulk(request: BulkEmailRequest): Promise<BulkEmailResult> {
    const batchSize = request.batchSize || 50;
    const results: EmailResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < request.emails.length; i += batchSize) {
      const batch = request.emails.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (email) => {
          const result = await this.sendTransactional(email);
          results.push(result);

          if (result.success) {
            successful++;
          } else {
            failed++;
          }
        })
      );
    }

    return {
      success: failed === 0,
      successful,
      failed,
      results,
      timestamp: new Date(),
    };
  }

  /**
   * Get email template
   */
  async getTemplate(templateId: string): Promise<EmailTemplate> {
    const result = await this.client.get('template', { version: 'v3' }).id(templateId).request();
    const template = (result.body as any).Data[0];

    return {
      id: template.ID.toString(),
      name: template.Name,
      subject: template.Subject || '',
      htmlContent: template.Html || '',
      textContent: template.Text,
      variables: [], // Mailjet doesn't expose variable definitions
      metadata: {
        createdAt: new Date(template.CreatedAt),
        updatedAt: new Date(template.EditedAt),
        version: '1.0',
      },
    };
  }

  /**
   * Create email template
   */
  async createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate> {
    const result = await this.client.post('template', { version: 'v3' }).request({
      Name: template.name,
      Subject: template.subject,
      Html: template.htmlContent,
      Text: template.textContent,
      Purposes: ['transactional'],
    });

    const created = (result.body as any).Data[0];

    return {
      id: created.ID.toString(),
      name: created.Name,
      subject: created.Subject,
      htmlContent: created.Html,
      textContent: created.Text,
      variables: template.variables || [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '1.0',
        tags: template.tags,
      },
    };
  }

  /**
   * List all templates
   */
  async listTemplates(): Promise<EmailTemplate[]> {
    const result = await this.client.get('template', { version: 'v3' }).request();
    const templates = (result.body as any).Data || [];

    return templates.map((t: any) => ({
      id: t.ID.toString(),
      name: t.Name,
      subject: t.Subject || '',
      htmlContent: t.Html || '',
      textContent: t.Text,
      variables: [],
      metadata: {
        createdAt: new Date(t.CreatedAt),
        updatedAt: new Date(t.EditedAt),
        version: '1.0',
      },
    }));
  }

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    await this.client.delete('template', { version: 'v3' }).id(templateId).request();
  }
}
