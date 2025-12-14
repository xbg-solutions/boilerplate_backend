# Email Connector

> Send transactional and marketing emails through multiple providers

## Overview

The Email Connector provides a unified interface for sending emails through various email service providers. It abstracts provider-specific implementations behind a common API, making it easy to switch providers or support multiple providers simultaneously.

## Features

- **Transactional emails** for user notifications, receipts, etc.
- **Marketing emails** for campaigns and newsletters
- **Bulk email sending** with batch processing
- **Template management** (create, read, update, delete)
- **Multiple providers** (Mailjet, Ortto)
- **Provider abstraction** for easy switching
- **Structured logging** with PII-safe information
- **Error handling** with detailed error responses
- **Attachment support** for files
- **Variable substitution** in templates
- **Tag support** for categorization

## Installation

```typescript
import {
  createEmailConnector,
  getEmailConnector,
  EmailConnector,
} from '../utilities/email-connector';
```

## Configuration

Configure in `functions/src/config/communications.config.ts`:

```typescript
export const COMMUNICATIONS_CONFIG = {
  email: {
    enabled: true,
    provider: 'mailjet', // or 'ortto'
    fromAddress: 'noreply@example.com',
    fromName: 'My App',
    providers: {
      mailjet: {
        apiKey: process.env.MAILJET_API_KEY || '',
        secretKey: process.env.MAILJET_SECRET_KEY || '',
      },
      ortto: {
        apiKey: process.env.ORTTO_API_KEY || '',
        region: 'us', // or 'au', 'eu'
      },
    },
  },
};
```

Set environment variables:

```bash
# Mailjet
MAILJET_API_KEY=your_api_key
MAILJET_SECRET_KEY=your_secret_key

# Ortto
ORTTO_API_KEY=your_api_key
```

## Usage

### Get Connector Instance

```typescript
import { getEmailConnector } from '../utilities/email-connector';

// Singleton instance
const emailConnector = getEmailConnector();

if (!emailConnector) {
  console.log('Email connector is disabled');
  return;
}
```

### Send Transactional Email

```typescript
const result = await emailConnector.sendTransactional({
  to: [
    { email: 'user@example.com', name: 'John Doe' }
  ],
  subject: 'Welcome to Our Service',
  htmlContent: '<h1>Welcome!</h1><p>Thanks for signing up.</p>',
  textContent: 'Welcome! Thanks for signing up.',
  replyTo: 'support@example.com',
  tags: ['welcome', 'onboarding'],
});

if (result.success) {
  console.log('Email sent:', result.messageId);
} else {
  console.error('Email failed:', result.error);
}
```

### Send Email with Template

```typescript
const result = await emailConnector.sendTransactional({
  to: [{ email: 'user@example.com', name: 'John Doe' }],
  templateId: 'welcome-email-v1',
  variables: {
    userName: 'John',
    activationLink: 'https://example.com/activate/abc123',
  },
  tags: ['welcome'],
});
```

### Send Marketing Email

```typescript
const result = await emailConnector.sendMarketing({
  to: [
    { email: 'user1@example.com' },
    { email: 'user2@example.com' },
  ],
  templateId: 'newsletter-template',
  campaignId: 'monthly-newsletter-2024-01',
  unsubscribeLink: 'https://example.com/unsubscribe',
  variables: {
    month: 'January',
    year: '2024',
  },
});
```

### Send Bulk Emails

```typescript
const bulkRequest = {
  emails: [
    {
      to: [{ email: 'user1@example.com', name: 'User 1' }],
      subject: 'Your receipt',
      htmlContent: '<p>Receipt for order #1</p>',
    },
    {
      to: [{ email: 'user2@example.com', name: 'User 2' }],
      subject: 'Your receipt',
      htmlContent: '<p>Receipt for order #2</p>',
    },
  ],
  batchSize: 100,
};

const result = await emailConnector.sendBulk(bulkRequest);

console.log(`Sent: ${result.successful}, Failed: ${result.failed}`);
```

### Send Email with Attachments

```typescript
const result = await emailConnector.sendTransactional({
  to: [{ email: 'user@example.com' }],
  subject: 'Your invoice',
  htmlContent: '<p>Please find your invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
      disposition: 'attachment',
    },
  ],
});
```

### Template Management

```typescript
// Create template
const template = await emailConnector.createTemplate({
  name: 'Welcome Email',
  subject: 'Welcome to {{companyName}}',
  htmlContent: '<h1>Welcome {{userName}}!</h1>',
  textContent: 'Welcome {{userName}}!',
  variables: [
    {
      name: 'userName',
      type: 'string',
      required: true,
      description: 'User\'s first name',
    },
    {
      name: 'companyName',
      type: 'string',
      required: true,
      description: 'Company name',
    },
  ],
  tags: ['onboarding'],
});

// Get template
const template = await emailConnector.getTemplate('template-id');

// List all templates
const templates = await emailConnector.listTemplates();

// Delete template
await emailConnector.deleteTemplate('template-id');
```

## API Reference

### EmailConnector

#### sendTransactional(request)

Send a transactional email.

**Parameters:**
- `request: TransactionalEmailRequest`

**Returns:** `Promise<EmailResult>`

#### sendMarketing(request)

Send a marketing email.

**Parameters:**
- `request: MarketingEmailRequest`

**Returns:** `Promise<EmailResult>`

#### sendBulk(request)

Send multiple emails in bulk.

**Parameters:**
- `request: BulkEmailRequest`

**Returns:** `Promise<BulkEmailResult>`

#### createTemplate(template)

Create a new email template.

**Parameters:**
- `template: CreateTemplateRequest`

**Returns:** `Promise<EmailTemplate>`

#### getTemplate(templateId)

Get an email template by ID.

**Parameters:**
- `templateId: string`

**Returns:** `Promise<EmailTemplate>`

#### listTemplates()

List all email templates.

**Returns:** `Promise<EmailTemplate[]>`

#### deleteTemplate(templateId)

Delete an email template.

**Parameters:**
- `templateId: string`

**Returns:** `Promise<void>`

## Types

### TransactionalEmailRequest

```typescript
interface TransactionalEmailRequest {
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
```

### EmailRecipient

```typescript
interface EmailRecipient {
  email: string;
  name?: string;
  variables?: Record<string, any>; // Per-recipient variables
}
```

### EmailResult

```typescript
interface EmailResult {
  success: boolean;
  messageId?: string;
  recipients?: number;
  error?: EmailError;
  timestamp: Date;
}
```

## Supported Providers

### Mailjet

**Features:**
- Transactional emails
- Marketing emails
- Template management
- Bulk sending

**Configuration:**
```typescript
providers: {
  mailjet: {
    apiKey: 'your_api_key',
    secretKey: 'your_secret_key',
  }
}
```

### Ortto

**Features:**
- Transactional emails
- Marketing emails with campaign tracking
- Advanced segmentation

**Configuration:**
```typescript
providers: {
  ortto: {
    apiKey: 'your_api_key',
    region: 'us', // 'us', 'au', or 'eu'
  }
}
```

## Event-Driven Usage

Automatically send emails in response to domain events:

```typescript
import { eventBus } from '../utilities/events';

// Subscribe to user created event
eventBus.subscribe('user.created', async (event) => {
  const emailConnector = getEmailConnector();
  if (!emailConnector) return;

  await emailConnector.sendTransactional({
    to: [{ email: event.payload.email, name: event.payload.name }],
    templateId: 'welcome-email',
    variables: {
      userName: event.payload.name,
    },
  });
});
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **SendGrid** provider implementation
- [ ] **AWS SES** provider implementation
- [ ] **Postmark** provider implementation
- [ ] **Resend** provider implementation
- [ ] **Brevo (Sendinblue)** provider implementation
- [ ] **Mandrill** provider implementation

### Missing Features
- [ ] **Email scheduling** (send at specific time)
- [ ] **Email tracking** (opens, clicks, bounces)
- [ ] **Delivery status webhooks**
- [ ] **Bounce handling** and categorization
- [ ] **Complaint handling** (spam reports)
- [ ] **Unsubscribe management**
- [ ] **Email verification** (verify recipient emails)
- [ ] **Rate limiting** per provider
- [ ] **Retry logic** with exponential backoff
- [ ] **Batch prioritization** (urgent vs. bulk)
- [ ] **Email preview** before sending
- [ ] **A/B testing** for email content
- [ ] **Personalization** beyond variable substitution
- [ ] **Dynamic content** based on recipient data
- [ ] **Multi-language support** for templates
- [ ] **Template versioning** and rollback
- [ ] **Email analytics** dashboard

### Advanced Template Features
- [ ] **Template inheritance** (base templates)
- [ ] **Conditional blocks** in templates
- [ ] **Loops** in templates
- [ ] **Partial templates** (reusable components)
- [ ] **CSS inlining** for better email client support
- [ ] **Responsive design** helpers
- [ ] **Dark mode** support
- [ ] **Template testing** tools

### Deliverability Features
- [ ] **SPF/DKIM/DMARC** setup guidance
- [ ] **Reputation monitoring**
- [ ] **Warm-up sequences** for new domains
- [ ] **List cleaning** (remove invalid emails)
- [ ] **Engagement scoring**
- [ ] **Suppression list** management

### Testing Gaps
- [ ] Unit tests for connector
- [ ] Provider integration tests
- [ ] Mock provider for testing
- [ ] Template rendering tests
- [ ] Bulk sending performance tests

### Configuration Gaps
- [ ] Multiple simultaneous providers
- [ ] Provider failover strategy
- [ ] Provider selection by criteria (cost, speed, features)
- [ ] Per-environment provider configuration

### Monitoring Gaps
- [ ] Email send metrics (volume, success rate)
- [ ] Provider-specific metrics
- [ ] Cost tracking per provider
- [ ] Queue depth monitoring
- [ ] Error rate alerting

### Security Gaps
- [ ] Email content sanitization
- [ ] Attachment virus scanning
- [ ] Recipient validation
- [ ] Rate limiting per recipient
- [ ] Spam filter testing

## Best Practices

1. **Use templates**: Prefer templates over raw HTML for consistency
2. **Include text version**: Always provide text alternative to HTML
3. **Tag your emails**: Use tags for analytics and debugging
4. **Handle errors**: Always check `result.success` before proceeding
5. **Batch wisely**: Use appropriate batch sizes for bulk sending
6. **Monitor deliverability**: Track bounce and complaint rates
7. **Test before sending**: Preview emails in multiple clients

## Common Patterns

### Send Receipt Email

```typescript
async function sendReceiptEmail(order: Order) {
  const emailConnector = getEmailConnector();
  if (!emailConnector) return;

  await emailConnector.sendTransactional({
    to: [{ email: order.customerEmail, name: order.customerName }],
    templateId: 'order-receipt',
    variables: {
      orderNumber: order.id,
      orderTotal: order.total,
      items: order.items,
    },
    attachments: [
      {
        filename: `receipt-${order.id}.pdf`,
        content: await generateReceiptPDF(order),
        contentType: 'application/pdf',
      },
    ],
    tags: ['receipt', 'transactional'],
  });
}
```

### Send Password Reset

```typescript
async function sendPasswordReset(user: User, resetToken: string) {
  const emailConnector = getEmailConnector();
  if (!emailConnector) return;

  const resetLink = `https://example.com/reset-password?token=${resetToken}`;

  await emailConnector.sendTransactional({
    to: [{ email: user.email, name: user.name }],
    templateId: 'password-reset',
    variables: {
      userName: user.name,
      resetLink,
      expiryHours: 24,
    },
    tags: ['password-reset', 'security'],
  });
}
```

## Related Components

- **communications.config.ts**: Email provider configuration
- **events**: Event bus for event-driven emails
- **logger**: Structured logging

## Support

For issues or questions:
- Verify provider credentials are configured
- Check provider-specific documentation
- Review email logs for error details
- Test with provider's sandbox/test mode first

## References

- [Mailjet Documentation](https://dev.mailjet.com/)
- [Ortto Documentation](https://help.ortto.com/)
- [Email Best Practices](https://sendgrid.com/blog/email-best-practices/)
