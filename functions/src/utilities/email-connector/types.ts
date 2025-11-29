/**
 * Email Connector Types
 */

export interface TransactionalEmailRequest {
  to: EmailRecipient[];
  templateId?: string;
  subject?: string;
  htmlContent?: string;
  textContent?: string;
  variables?: Record<string, any>;
  attachments?: EmailAttachment[];
  replyTo?: string;
  tags?: string[];
}

export interface MarketingEmailRequest extends TransactionalEmailRequest {
  listId?: string;
  campaignId?: string;
  unsubscribeLink?: string;
}

export interface BulkEmailRequest {
  emails: TransactionalEmailRequest[];
  batchSize?: number;
}

export interface EmailRecipient {
  email: string;
  name?: string;
  variables?: Record<string, any>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  disposition?: 'attachment' | 'inline';
  contentId?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  recipients?: number;
  error?: EmailError;
  timestamp: Date;
}

export interface BulkEmailResult {
  success: boolean;
  successful: number;
  failed: number;
  results: EmailResult[];
  timestamp: Date;
}

export interface EmailError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables: TemplateVariable[];
  metadata: TemplateMetadata;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  defaultValue?: any;
  description?: string;
}

export interface TemplateMetadata {
  createdAt: Date;
  updatedAt: Date;
  version: string;
  author?: string;
  tags?: string[];
}

export interface CreateTemplateRequest {
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables?: TemplateVariable[];
  tags?: string[];
}
