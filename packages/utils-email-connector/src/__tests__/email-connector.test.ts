/**
 * Email Connector Tests
 */

import { EmailConnector, EmailProvider } from '../email-connector';
import {
  BulkEmailRequest,
  BulkEmailResult,
  CreateTemplateRequest,
  EmailResult,
  EmailTemplate,
  MarketingEmailRequest,
  TransactionalEmailRequest,
} from '../types';

/**
 * In-memory EmailProvider fake. Records what it was asked to send so the tests
 * can assert on it, and can be told to fail the next operation so the
 * connector's error path is exercised.
 */
const createMockEmailProvider = () => {
  const sentEmails: TransactionalEmailRequest[] = [];
  const sentMarketing: MarketingEmailRequest[] = [];
  const sentBulk: BulkEmailRequest[] = [];
  const createdTemplates: EmailTemplate[] = [];
  let failNext = false;
  let templateSeq = 0;

  const consumeFailure = () => {
    if (!failNext) return;
    failNext = false;
    throw new Error('Simulated provider failure');
  };

  const ok = (recipients: number): EmailResult => ({
    success: true,
    messageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    recipients,
    timestamp: new Date(),
  });

  return {
    sentEmails,
    sentMarketing,
    sentBulk,
    createdTemplates,

    failNextOperation(): void {
      failNext = true;
    },

    reset(): void {
      sentEmails.length = 0;
      sentMarketing.length = 0;
      sentBulk.length = 0;
      createdTemplates.length = 0;
      failNext = false;
      templateSeq = 0;
    },

    async sendTransactional(request: TransactionalEmailRequest): Promise<EmailResult> {
      consumeFailure();
      sentEmails.push(request);
      return ok(request.to.length);
    },

    async sendMarketing(request: MarketingEmailRequest): Promise<EmailResult> {
      consumeFailure();
      sentMarketing.push(request);
      return ok(request.to.length);
    },

    async sendBulk(request: BulkEmailRequest): Promise<BulkEmailResult> {
      consumeFailure();
      sentBulk.push(request);
      const results = request.emails.map((m) => ok(m.to.length));
      return {
        success: true,
        successful: results.length,
        failed: 0,
        results,
        timestamp: new Date(),
      };
    },

    async getTemplate(templateId: string): Promise<EmailTemplate> {
      consumeFailure();
      const found = createdTemplates.find((t) => t.id === templateId);
      if (!found) throw new Error(`Template not found: ${templateId}`);
      return found;
    },

    async createTemplate(template: CreateTemplateRequest): Promise<EmailTemplate> {
      consumeFailure();
      const created = {
        ...template,
        id: `tpl-${++templateSeq}`,
        variables: template.variables ?? [],
        metadata: { createdAt: new Date(), updatedAt: new Date() },
      } as unknown as EmailTemplate;
      createdTemplates.push(created);
      return created;
    },

    async listTemplates(): Promise<EmailTemplate[]> {
      consumeFailure();
      return [...createdTemplates];
    },

    async deleteTemplate(templateId: string): Promise<void> {
      consumeFailure();
      const i = createdTemplates.findIndex((t) => t.id === templateId);
      if (i >= 0) createdTemplates.splice(i, 1);
    },
  } satisfies EmailProvider & Record<string, unknown>;
};

// Mock the logger module
jest.mock('@xbg.solutions/utils-logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Email Connector', () => {
  let connector: EmailConnector;
  let mockProvider: ReturnType<typeof createMockEmailProvider>;

  beforeEach(() => {
    mockProvider = createMockEmailProvider();
    connector = new EmailConnector(mockProvider);
  });

  afterEach(() => {
    mockProvider.reset();
  });

  describe('sendTransactional', () => {
    it('should send a transactional email', async () => {
      const request = {
        to: [{ email: 'user@example.com', name: 'Test User' }],
        subject: 'Test Email',
        htmlContent: '<p>Test</p>',
        textContent: 'Test',
      };

      const result = await connector.sendTransactional(request);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.recipients).toBe(1);
      expect(mockProvider.sentEmails).toHaveLength(1);
      expect(mockProvider.sentEmails[0]).toEqual(request);
    });

    it('should send email with template', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        templateId: 'welcome-email',
        variables: {
          userName: 'John',
          activationLink: 'https://example.com/activate',
        },
      };

      const result = await connector.sendTransactional(request);

      expect(result.success).toBe(true);
      expect(mockProvider.sentEmails[0].templateId).toBe('welcome-email');
      expect(mockProvider.sentEmails[0].variables).toEqual(request.variables);
    });

    it('should send email with attachments', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Email with attachment',
        htmlContent: '<p>See attachment</p>',
        attachments: [
          {
            filename: 'invoice.pdf',
            content: Buffer.from('PDF content'),
            contentType: 'application/pdf',
          },
        ],
      };

      const result = await connector.sendTransactional(request);

      expect(result.success).toBe(true);
      expect(mockProvider.sentEmails[0].attachments).toBeDefined();
      expect(mockProvider.sentEmails[0].attachments![0].filename).toBe('invoice.pdf');
    });

    it('should handle multiple recipients', async () => {
      const request = {
        to: [
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' },
          { email: 'user3@example.com', name: 'User 3' },
        ],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      };

      const result = await connector.sendTransactional(request);

      expect(result.success).toBe(true);
      expect(result.recipients).toBe(3);
    });

    it('should handle provider failure', async () => {
      mockProvider.failNextOperation();

      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      };

      const result = await connector.sendTransactional(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('SEND_ERROR');
    });

    it('should add tags to email', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
        tags: ['welcome', 'onboarding'],
      };

      await connector.sendTransactional(request);

      expect(mockProvider.sentEmails[0].tags).toEqual(['welcome', 'onboarding']);
    });

    it('should set reply-to address', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
        replyTo: 'support@example.com',
      };

      await connector.sendTransactional(request);

      expect(mockProvider.sentEmails[0].replyTo).toBe('support@example.com');
    });
  });

  describe('sendMarketing', () => {
    it('should send a marketing email', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Newsletter',
        htmlContent: '<p>Newsletter content</p>',
        campaignId: 'monthly-newsletter-2024-01',
      };

      const result = await connector.sendMarketing(request);

      expect(result.success).toBe(true);
      expect(mockProvider.sentMarketing).toHaveLength(1);
      expect(mockProvider.sentMarketing[0].campaignId).toBe('monthly-newsletter-2024-01');
    });

    it('should include unsubscribe link', async () => {
      const request = {
        to: [{ email: 'user@example.com' }],
        subject: 'Newsletter',
        htmlContent: '<p>Newsletter</p>',
        unsubscribeLink: 'https://example.com/unsubscribe',
      };

      await connector.sendMarketing(request);

      expect(mockProvider.sentMarketing[0].unsubscribeLink).toBe('https://example.com/unsubscribe');
    });
  });

  describe('sendBulk', () => {
    it('should send bulk emails', async () => {
      const request = {
        emails: [
          {
            to: [{ email: 'user1@example.com' }],
            subject: 'Email 1',
            htmlContent: '<p>Content 1</p>',
          },
          {
            to: [{ email: 'user2@example.com' }],
            subject: 'Email 2',
            htmlContent: '<p>Content 2</p>',
          },
          {
            to: [{ email: 'user3@example.com' }],
            subject: 'Email 3',
            htmlContent: '<p>Content 3</p>',
          },
        ],
        batchSize: 100,
      };

      const result = await connector.sendBulk(request);

      expect(result.success).toBe(true);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(mockProvider.sentBulk).toHaveLength(1);
    });

    it('should handle bulk send failure', async () => {
      mockProvider.failNextOperation();

      const request = {
        emails: [
          {
            to: [{ email: 'user@example.com' }],
            subject: 'Test',
            htmlContent: '<p>Test</p>',
          },
        ],
      };

      const result = await connector.sendBulk(request);

      expect(result.success).toBe(false);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
    });
  });

  describe('Template Management', () => {
    it('should create a template', async () => {
      const template = {
        name: 'Welcome Email',
        subject: 'Welcome to {{companyName}}',
        htmlContent: '<h1>Welcome {{userName}}!</h1>',
        textContent: 'Welcome {{userName}}!',
        variables: [
          {
            name: 'userName',
            type: 'string' as const,
            required: true,
          },
          {
            name: 'companyName',
            type: 'string' as const,
            required: true,
          },
        ],
        tags: ['onboarding'],
      };

      const created = await connector.createTemplate(template);

      expect(created.id).toBeDefined();
      expect(created.name).toBe(template.name);
      expect(created.subject).toBe(template.subject);
      expect(mockProvider.createdTemplates).toHaveLength(1);
    });

    it('should get a template', async () => {
      const template = {
        name: 'Test Template',
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      };

      const created = await connector.createTemplate(template);
      const retrieved = await connector.getTemplate(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe(template.name);
    });

    it('should list all templates', async () => {
      await connector.createTemplate({
        name: 'Template 1',
        subject: 'Subject 1',
        htmlContent: '<p>Content 1</p>',
      });

      await connector.createTemplate({
        name: 'Template 2',
        subject: 'Subject 2',
        htmlContent: '<p>Content 2</p>',
      });

      const templates = await connector.listTemplates();

      expect(templates).toHaveLength(2);
    });

    it('should delete a template', async () => {
      const template = {
        name: 'Test Template',
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      };

      const created = await connector.createTemplate(template);

      await connector.deleteTemplate(created.id);

      await expect(connector.getTemplate(created.id)).rejects.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should return error result on exception', async () => {
      // Create a provider that throws an error
      const throwingProvider = {
        ...mockProvider,
        sendTransactional: jest.fn().mockRejectedValue(new Error('Network error')),
      } as any;

      const connector = new EmailConnector(throwingProvider);

      const result = await connector.sendTransactional({
        to: [{ email: 'user@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Network error');
    });
  });
});
