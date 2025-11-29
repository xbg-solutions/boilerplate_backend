/**
 * Mock Email Provider
 * For testing email connector without actual API calls
 */

import { EmailProvider } from '../../utilities/email-connector/email-connector';
import {
  TransactionalEmailRequest,
  MarketingEmailRequest,
  BulkEmailRequest,
  EmailResult,
  BulkEmailResult,
  EmailTemplate,
  CreateTemplateRequest,
} from '../../utilities/email-connector/types';

export class MockEmailProvider implements EmailProvider {
  public sentEmails: TransactionalEmailRequest[] = [];
  public sentMarketing: MarketingEmailRequest[] = [];
  public sentBulk: BulkEmailRequest[] = [];
  public createdTemplates: CreateTemplateRequest[] = [];

  private shouldFail = false;
  private templates: Map<string, EmailTemplate> = new Map();
  private templateIdCounter = 0;

  /**
   * Configure provider to fail next operation
   */
  failNextOperation() {
    this.shouldFail = true;
  }

  /**
   * Reset provider state
   */
  reset() {
    this.sentEmails = [];
    this.sentMarketing = [];
    this.sentBulk = [];
    this.createdTemplates = [];
    this.templates.clear();
    this.shouldFail = false;
    this.templateIdCounter = 0;
  }

  /**
   * Send transactional email
   */
  async sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return {
        success: false,
        error: {
          code: 'SEND_ERROR',
          message: 'Mock provider configured to fail',
        },
        timestamp: new Date(),
      };
    }

    this.sentEmails.push(request);

    return {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random()}`,
      recipients: request.to.length,
      timestamp: new Date(),
    };
  }

  /**
   * Send marketing email
   */
  async sendMarketing(request: MarketingEmailRequest): Promise<EmailResult> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return {
        success: false,
        error: {
          code: 'MARKETING_SEND_ERROR',
          message: 'Mock provider configured to fail',
        },
        timestamp: new Date(),
      };
    }

    this.sentMarketing.push(request);

    return {
      success: true,
      messageId: `marketing_${Date.now()}`,
      recipients: request.to.length,
      timestamp: new Date(),
    };
  }

  /**
   * Send bulk emails
   */
  async sendBulk(request: BulkEmailRequest): Promise<BulkEmailResult> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return {
        success: false,
        successful: 0,
        failed: request.emails.length,
        results: [],
        timestamp: new Date(),
      };
    }

    this.sentBulk.push(request);

    const results: EmailResult[] = request.emails.map((email, index) => ({
      success: true,
      messageId: `bulk_${Date.now()}_${index}`,
      recipients: email.to.length,
      timestamp: new Date(),
    }));

    return {
      success: true,
      successful: results.length,
      failed: 0,
      results,
      timestamp: new Date(),
    };
  }

  /**
   * Get email template
   */
  async getTemplate(templateId: string): Promise<EmailTemplate> {
    const template = this.templates.get(templateId);

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    return template;
  }

  /**
   * Create email template
   */
  async createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate> {
    this.createdTemplates.push(template);

    const created: EmailTemplate = {
      id: `tpl_${++this.templateIdCounter}`,
      name: template.name,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent,
      variables: template.variables || [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '1.0',
        tags: template.tags,
      },
    };

    this.templates.set(created.id, created);

    return created;
  }

  /**
   * List all email templates
   */
  async listTemplates(): Promise<EmailTemplate[]> {
    return Array.from(this.templates.values());
  }

  /**
   * Delete email template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    if (!this.templates.has(templateId)) {
      throw new Error(`Template ${templateId} not found`);
    }

    this.templates.delete(templateId);
  }
}

/**
 * Create a mock email provider
 */
export const createMockEmailProvider = (): MockEmailProvider => {
  return new MockEmailProvider();
};
