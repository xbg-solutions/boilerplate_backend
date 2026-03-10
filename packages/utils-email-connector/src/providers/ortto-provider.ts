/**
 * Ortto Email Provider
 * Implementation for transactional emails via Ortto
 * https://help.ortto.com/developer/latest/
 */

import axios, { AxiosInstance } from 'axios';
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

export interface OrttoEmailConfig {
  apiKey: string;
  region?: 'us' | 'au' | 'eu';
  fromEmail: string;
  fromName: string;
}

export class OrttoEmailProvider implements EmailProvider {
  private client: AxiosInstance;
  private config: OrttoEmailConfig;

  constructor(config: OrttoEmailConfig) {
    this.config = config;

    const baseURL = this.getBaseURL(config.region || 'us');

    this.client = axios.create({
      baseURL,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  private getBaseURL(region: string): string {
    const regionMap: Record<string, string> = {
      us: 'https://api.ortto.com',
      au: 'https://api.ap-southeast-2.ortto.com',
      eu: 'https://api.eu-west-1.ortto.com',
    };
    return regionMap[region] || regionMap.us;
  }

  /**
   * Send transactional email via Ortto
   */
  async sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult> {
    try {
      const payload = {
        from: {
          email: this.config.fromEmail,
          name: this.config.fromName,
        },
        to: request.to.map(recipient => ({
          email: recipient.email,
          name: recipient.name,
        })),
        subject: request.subject,
        reply_to: request.replyTo,
        template_id: request.templateId,
        variables: request.variables || {},
        html: request.htmlContent,
        text: request.textContent,
        attachments: request.attachments?.map(att => ({
          filename: att.filename,
          content_type: att.contentType || 'application/octet-stream',
          content: Buffer.isBuffer(att.content)
            ? att.content.toString('base64')
            : Buffer.from(att.content).toString('base64'),
        })),
        tags: request.tags,
      };

      const response = await this.client.post('/v1/email/send', payload);

      return {
        success: true,
        messageId: response.data?.message_id,
        recipients: request.to.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.response?.status?.toString() || 'ORTTO_ERROR',
          message: error.message || 'Unknown Ortto error',
          details: error.response?.data,
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send marketing email
   * Note: For Ortto, marketing campaigns are better handled via journey-connector
   * This method delegates to transactional for simple sends
   */
  async sendMarketing(request: MarketingEmailRequest): Promise<EmailResult> {
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

      // Add delay between batches to respect rate limits
      if (i + batchSize < request.emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
    try {
      const response = await this.client.get(`/v1/email/templates/${templateId}`);
      const template = response.data;

      return {
        id: template.id,
        name: template.name,
        subject: template.subject || '',
        htmlContent: template.html || '',
        textContent: template.text,
        variables: template.variables || [],
        metadata: {
          createdAt: new Date(template.created_at),
          updatedAt: new Date(template.updated_at),
          version: template.version || '1.0',
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to get template: ${error.message}`);
    }
  }

  /**
   * Create email template
   */
  async createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate> {
    try {
      const response = await this.client.post('/v1/email/templates', {
        name: template.name,
        subject: template.subject,
        html: template.htmlContent,
        text: template.textContent,
        variables: template.variables,
        tags: template.tags,
      });

      const created = response.data;

      return {
        id: created.id,
        name: created.name,
        subject: created.subject,
        htmlContent: created.html,
        textContent: created.text,
        variables: template.variables || [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          version: '1.0',
          tags: template.tags,
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to create template: ${error.message}`);
    }
  }

  /**
   * List all templates
   */
  async listTemplates(): Promise<EmailTemplate[]> {
    try {
      const response = await this.client.get('/v1/email/templates');
      const templates = response.data?.templates || [];

      return templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        subject: t.subject || '',
        htmlContent: t.html || '',
        textContent: t.text,
        variables: t.variables || [],
        metadata: {
          createdAt: new Date(t.created_at),
          updatedAt: new Date(t.updated_at),
          version: t.version || '1.0',
        },
      }));
    } catch (error: any) {
      throw new Error(`Failed to list templates: ${error.message}`);
    }
  }

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    try {
      await this.client.delete(`/v1/email/templates/${templateId}`);
    } catch (error: any) {
      throw new Error(`Failed to delete template: ${error.message}`);
    }
  }
}
