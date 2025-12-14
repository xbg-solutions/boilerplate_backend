# Communication Utilities Guide

## Overview

The communication utilities provide a comprehensive layer for external integrations including:

- **SNS Connector** - Stream domain events to external systems
- **Email Connector** - Send transactional and marketing emails (Mailjet)
- **SMS Connector** - Send SMS messages (Twilio)
- **CRM Connector** - Sync customer data (HubSpot, Salesforce, Attio)

All connectors follow the proven provider abstraction pattern and integrate seamlessly with the event bus for automated, event-driven communication.

## Architecture

```
Domain Events → Event Bus → Communication Subscribers → Connectors → External Services
```

### Key Features

✅ **Provider Abstraction** - Easy to switch providers
✅ **Event-Driven** - Automatic notifications based on domain events
✅ **Type-Safe** - Comprehensive TypeScript interfaces
✅ **PII-Safe Logging** - Sensitive data protection
✅ **Error Handling** - Retry logic and graceful degradation
✅ **Singleton Pattern** - Efficient resource usage

## Configuration

### Environment Variables

```bash
# SNS Configuration
SNS_ENABLED=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
SNS_USER_EVENTS_TOPIC=arn:aws:sns:us-east-1:123456:user-events
SNS_ORDER_EVENTS_TOPIC=arn:aws:sns:us-east-1:123456:order-events
SNS_SYSTEM_EVENTS_TOPIC=arn:aws:sns:us-east-1:123456:system-events

# Email Configuration (Mailjet)
EMAIL_ENABLED=true
EMAIL_PROVIDER=mailjet
MAILJET_API_KEY=your-api-key
MAILJET_SECRET_KEY=your-secret-key
EMAIL_FROM_ADDRESS=noreply@yourapp.com
EMAIL_FROM_NAME=Your App
EMAIL_REPLY_TO=support@yourapp.com
EMAIL_TRACK_OPENS=true
EMAIL_TRACK_CLICKS=true

# SMS Configuration (Twilio)
SMS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM_NUMBER=+1234567890

# CRM Configuration
CRM_ENABLED=true
CRM_PROVIDER=hubspot
HUBSPOT_API_KEY=your-api-key
CRM_SYNC_EVENTS=USER_CREATED,ORDER_COMPLETED
CRM_BATCH_SIZE=100
CRM_RETRY_ATTEMPTS=3
CRM_RETRY_DELAY=1000

# Alternative CRM Providers
# SALESFORCE_CLIENT_ID=your-client-id
# SALESFORCE_CLIENT_SECRET=your-client-secret
# SALESFORCE_LOGIN_URL=https://login.salesforce.com
# SALESFORCE_API_VERSION=58.0
# ATTIO_API_KEY=your-api-key
```

## Usage

### 1. SNS Connector

Stream domain events to external systems via AWS SNS.

```typescript
import { getSNSConnector } from './utilities/sns-connector';

const snsConnector = getSNSConnector();

// Publish single event
await snsConnector.publishEvent(
  process.env.SNS_USER_EVENTS_TOPIC!,
  {
    eventType: 'USER_REGISTERED',
    entityType: 'User',
    entityId: 'user-123',
    data: { email: 'user@example.com', name: 'John Doe' },
    metadata: {
      timestamp: new Date(),
      correlationId: 'req-456',
      userId: 'user-123',
      source: 'web-app',
      version: '1.0',
    },
  }
);

// Publish batch
await snsConnector.publishBatch(topicArn, events);

// Manage topics
const topic = await snsConnector.createTopic('my-events');
await snsConnector.subscribeTopic(topicArn, 'https://webhook.example.com', 'https');
```

### 2. Email Connector

Send transactional and marketing emails.

```typescript
import { getEmailConnector } from './utilities/email-connector';

const emailConnector = getEmailConnector();

// Send transactional email
await emailConnector.sendTransactional({
  to: [{ email: 'user@example.com', name: 'John Doe' }],
  templateId: 'welcome-email',
  variables: {
    firstName: 'John',
    activationLink: 'https://app.example.com/activate/token',
  },
  tags: ['welcome', 'onboarding'],
});

// Send with HTML content
await emailConnector.sendTransactional({
  to: [{ email: 'user@example.com' }],
  subject: 'Welcome!',
  htmlContent: '<h1>Welcome to our app!</h1>',
  textContent: 'Welcome to our app!',
});

// Send bulk emails
await emailConnector.sendBulk({
  emails: users.map(user => ({
    to: [user],
    templateId: 'newsletter',
    variables: { name: user.name },
  })),
  batchSize: 50,
});

// Template management
const template = await emailConnector.getTemplate('welcome-email');
await emailConnector.createTemplate({
  name: 'welcome-email',
  subject: 'Welcome {{firstName}}!',
  htmlContent: '<h1>Hello {{firstName}}</h1>',
});
```

### 3. SMS Connector

Send SMS messages via Twilio.

```typescript
import { getSMSConnector } from './utilities/sms-connector';

const smsConnector = getSMSConnector();

// Send SMS
await smsConnector.sendMessage({
  to: '+1234567890',
  message: 'Your verification code is: 123456',
  validityPeriod: 600, // 10 minutes
  tags: ['verification'],
});

// Send MMS with media
await smsConnector.sendMessage({
  to: '+1234567890',
  message: 'Check out this image!',
  mediaUrls: ['https://example.com/image.jpg'],
});

// Check message status
const status = await smsConnector.getMessageStatus(messageId);
console.log(`Status: ${status.status}`);

// Get delivery report
const report = await smsConnector.getDeliveryReport(messageId);
console.log(`Delivered: ${report.delivered}`);
```

### 4. CRM Connector

Sync customer data with CRM systems.

```typescript
import { getCRMConnector } from './utilities/crm-connector';

const crmConnector = getCRMConnector();

// Create contact
await crmConnector.createContact({
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+1234567890',
  company: 'Acme Inc',
  jobTitle: 'Software Engineer',
  customFields: {
    signup_date: new Date().toISOString(),
    user_tier: 'premium',
  },
  tags: ['new-user', 'premium'],
  source: 'web_app',
});

// Update contact
await crmConnector.updateContact('contact-123', {
  jobTitle: 'Senior Software Engineer',
  customFields: { last_activity: new Date().toISOString() },
});

// Search contacts
const result = await crmConnector.searchContacts({
  email: 'user@example.com',
  limit: 10,
});

// Log activity
await crmConnector.logActivity({
  contactEmail: 'user@example.com',
  type: 'purchase',
  subject: 'Premium Plan Purchase',
  description: 'User upgraded to premium',
  customFields: {
    plan_name: 'Premium',
    plan_price: 99,
  },
});

// Create company
await crmConnector.createCompany({
  name: 'Acme Inc',
  domain: 'acme.com',
  industry: 'Technology',
  size: '50-100',
});

// Create deal
await crmConnector.createDeal({
  name: 'Enterprise Deal',
  amount: 50000,
  stage: 'negotiation',
  contactId: 'contact-123',
  closeDate: new Date('2024-12-31'),
  probability: 75,
});
```

## Event-Driven Integration

The communication utilities integrate automatically with the event bus. Simply enable the subscribers:

```typescript
// In your index.ts
import { initializeCommunicationSubscribers } from './subscribers/communication-subscribers';

// Initialize on startup
initializeCommunicationSubscribers();

// Now all domain events automatically trigger communications!
// No manual connector calls needed
```

### Built-in Event Handlers

The system includes pre-configured handlers for common events:

- **USER_CREATED** → Send welcome email + Create CRM contact + Publish to SNS
- **ORDER_COMPLETED** → Send confirmation email + Log CRM activity
- **PHONE_VERIFICATION_REQUESTED** → Send SMS with code

### Custom Event Handlers

Add your own handlers:

```typescript
eventBus.subscribe(EventType.ORDER_SHIPPED, async (payload) => {
  const emailConnector = getEmailConnector();

  await emailConnector?.sendTransactional({
    to: [{ email: payload.order.customerEmail }],
    templateId: 'order-shipped',
    variables: {
      orderNumber: payload.order.id,
      trackingUrl: payload.order.trackingUrl,
    },
  });
});
```

## Provider Switching

### Switching Email Providers

```bash
# Change from Mailjet to SendGrid
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your-sendgrid-key
```

### Switching CRM Providers

```bash
# Change from HubSpot to Salesforce
CRM_PROVIDER=salesforce
SALESFORCE_CLIENT_ID=your-client-id
SALESFORCE_CLIENT_SECRET=your-client-secret
```

## Best Practices

1. **Use Templates** - Store email content in templates, not code
2. **Tag Everything** - Use tags for analytics and filtering
3. **Handle Errors** - Always check result.success and log errors
4. **Rate Limiting** - Be mindful of provider rate limits
5. **PII Protection** - Never log sensitive user data
6. **Testing** - Test with real providers in staging environment
7. **Monitoring** - Monitor delivery rates and failures

## Troubleshooting

### Email Not Sending

1. Check `EMAIL_ENABLED=true` in env
2. Verify API credentials
3. Check template ID exists
4. Review email connector logs

### SMS Failures

1. Verify phone number is in E.164 format (+1234567890)
2. Check Twilio account balance
3. Verify from number is verified
4. Review SMS connector logs

### CRM Sync Issues

1. Check `CRM_ENABLED=true`
2. Verify API credentials
3. Ensure custom fields exist in CRM
4. Check rate limits

## Examples

See `examples/communications-usage.ts` for comprehensive usage examples.

## Security

- API keys are stored in environment variables
- Phone numbers are masked in logs
- Email addresses are not logged in production
- All connections use HTTPS/TLS

## Performance

- Connectors use singleton pattern
- Bulk operations are batched
- Async/await for non-blocking I/O
- Graceful degradation if providers unavailable

## Support

For issues or questions:
- Check logs for error details
- Review provider documentation
- Verify configuration
- Test in development first
