# SMS Connector

> Send SMS messages through multiple providers for notifications and verification

## Overview

The SMS Connector provides a unified interface for sending SMS messages through various SMS service providers. It abstracts provider-specific implementations and provides features like bulk sending, delivery tracking, and PII-safe logging.

## Features

- **SMS messaging** with text and media (MMS)
- **Bulk sending** with batch processing
- **Delivery tracking** and status reporting
- **Multiple providers** (Twilio, MessageBird)
- **Provider abstraction** for easy switching
- **PII-safe logging** (phone number masking)
- **Cost tracking** per message
- **Validity periods** for message expiration
- **Metadata support** for custom data
- **Error handling** with detailed responses

## Installation

```typescript
import {
  createSMSConnector,
  getSMSConnector,
  SMSConnector,
} from '../utilities/sms-connector';
```

## Configuration

Configure in `functions/src/config/communications.config.ts`:

```typescript
export const COMMUNICATIONS_CONFIG = {
  sms: {
    enabled: true,
    provider: 'twilio', // or 'messagebird'
    providers: {
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_FROM_NUMBER || '',
      },
      messagebird: {
        apiKey: process.env.MESSAGEBIRD_API_KEY || '',
        fromNumber: process.env.MESSAGEBIRD_FROM_NUMBER || '',
      },
    },
  },
};
```

Set environment variables:

```bash
# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890

# MessageBird
MESSAGEBIRD_API_KEY=your_api_key
MESSAGEBIRD_FROM_NUMBER=+1234567890
```

## Usage

### Send SMS

```typescript
import { getSMSConnector } from '../utilities/sms-connector';

const smsConnector = getSMSConnector();
if (!smsConnector) {
  console.log('SMS connector is disabled');
  return;
}

const result = await smsConnector.sendMessage({
  to: '+61412345678',
  message: 'Your verification code is 123456',
  tags: ['verification', '2fa'],
});

if (result.success) {
  console.log('SMS sent:', result.messageId);
  console.log('Cost:', result.cost);
} else {
  console.error('SMS failed:', result.error);
}
```

### Send MMS with Media

```typescript
const result = await smsConnector.sendMessage({
  to: '+61412345678',
  message: 'Check out this image!',
  mediaUrls: [
    'https://example.com/image.jpg',
  ],
  tags: ['mms', 'marketing'],
});
```

### Send Bulk SMS

```typescript
const requests = [
  { to: '+61412345678', message: 'Message 1' },
  { to: '+61487654321', message: 'Message 2' },
  { to: '+61411111111', message: 'Message 3' },
];

const result = await smsConnector.sendBulk(requests);

console.log(`Sent: ${result.successful}, Failed: ${result.failed}`);
console.log(`Total cost: $${result.totalCost}`);
```

### Track Message Status

```typescript
const status = await smsConnector.getMessageStatus(messageId);

console.log('Status:', status.status); // 'delivered', 'failed', etc.
if (status.errorCode) {
  console.log('Error:', status.errorMessage);
}
```

### Get Delivery Report

```typescript
const report = await smsConnector.getDeliveryReport(messageId);

if (report.delivered) {
  console.log('Delivered at:', report.deliveredAt);
} else {
  console.log('Failed:', report.errorMessage);
}
```

## API Reference

### SMSConnector

#### sendMessage(request)

Send a single SMS message.

**Parameters:**
- `request: SMSRequest`

**Returns:** `Promise<SMSResult>`

#### sendBulk(requests)

Send multiple SMS messages in bulk.

**Parameters:**
- `requests: SMSRequest[]`

**Returns:** `Promise<BulkSMSResult>`

#### getMessageStatus(messageId)

Get the status of a sent message.

**Parameters:**
- `messageId: string`

**Returns:** `Promise<MessageStatus>`

#### getDeliveryReport(messageId)

Get the delivery report for a message.

**Parameters:**
- `messageId: string`

**Returns:** `Promise<DeliveryReport>`

## Types

### SMSRequest

```typescript
interface SMSRequest {
  to: string;              // E.164 format: +61412345678
  message: string;
  from?: string;           // Override default from number
  mediaUrls?: string[];    // For MMS
  validityPeriod?: number; // Minutes until expiry
  tags?: string[];
  metadata?: Record<string, any>;
}
```

### SMSResult

```typescript
interface SMSResult {
  success: boolean;
  messageId?: string;
  cost?: number;
  error?: SMSError;
  provider: string;
  timestamp: Date;
}
```

### MessageStatus

```typescript
interface MessageStatus {
  messageId: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered';
  to: string;
  from: string;
  body: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: Date;
}
```

## Supported Providers

### Twilio

**Features:**
- SMS and MMS
- Delivery tracking
- Global coverage
- Programmable messaging

**Configuration:**
```typescript
providers: {
  twilio: {
    accountSid: 'your_account_sid',
    authToken: 'your_auth_token',
    fromNumber: '+1234567890',
  }
}
```

### MessageBird

**Features:**
- SMS messaging
- International delivery
- Cost-effective
- Real-time delivery reports

**Configuration:**
```typescript
providers: {
  messagebird: {
    apiKey: 'your_api_key',
    fromNumber: '+1234567890',
  }
}
```

## Event-Driven Usage

Send SMS notifications in response to domain events:

```typescript
import { eventBus } from '../utilities/events';

// Subscribe to 2FA request event
eventBus.subscribe('auth.2fa-requested', async (event) => {
  const smsConnector = getSMSConnector();
  if (!smsConnector) return;

  await smsConnector.sendMessage({
    to: event.payload.phoneNumber,
    message: `Your verification code is ${event.payload.code}`,
    validityPeriod: 10, // 10 minutes
    tags: ['2fa', 'security'],
  });
});
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **AWS SNS SMS** provider implementation
- [ ] **Vonage (Nexmo)** provider implementation
- [ ] **Plivo** provider implementation
- [ ] **Bandwidth** provider implementation
- [ ] **Telnyx** provider implementation
- [ ] **Africa's Talking** for African markets

### Missing Features
- [ ] **Two-way messaging** (receive SMS)
- [ ] **Short codes** support
- [ ] **Long codes** vs. toll-free number selection
- [ ] **Message templates** for common messages
- [ ] **Opt-out management** (STOP/UNSUBSCRIBE handling)
- [ ] **Consent tracking** for compliance
- [ ] **Number validation** before sending
- [ ] **Carrier lookup** to check if number is valid
- [ ] **Time zone awareness** (don't send at night)
- [ ] **Rate limiting** per recipient
- [ ] **Retry logic** with exponential backoff
- [ ] **Message scheduling** (send at specific time)
- [ ] **Delivery webhooks** for real-time updates
- [ ] **Cost estimation** before sending
- [ ] **Balance checking** for prepaid accounts
- [ ] **Alphanumeric sender IDs**
- [ ] **Unicode support** for international characters

### Compliance Features
- [ ] **TCPA compliance** (US regulations)
- [ ] **GDPR compliance** for EU
- [ ] **CASL compliance** (Canada)
- [ ] **Opt-in/opt-out** management
- [ ] **Do Not Call** list integration
- [ ] **Consent audit trail**
- [ ] **Message retention policies**

### Analytics & Reporting
- [ ] **Delivery rate** tracking
- [ ] **Cost analysis** by country/carrier
- [ ] **Engagement metrics**
- [ ] **Failed message** analysis
- [ ] **Provider performance** comparison
- [ ] **Usage dashboards**

### Testing Gaps
- [ ] Unit tests for connector
- [ ] Provider integration tests
- [ ] Mock provider for testing
- [ ] Delivery simulation tests
- [ ] Load testing for bulk sends

### Configuration Gaps
- [ ] Multiple simultaneous providers
- [ ] Provider failover strategy
- [ ] Country-specific provider routing
- [ ] Cost-based provider selection

### Monitoring Gaps
- [ ] SMS send volume metrics
- [ ] Success/failure rates
- [ ] Cost tracking and alerts
- [ ] Provider uptime monitoring
- [ ] Queue depth monitoring

## Best Practices

1. **Use E.164 format**: Always format phone numbers as +[country][number]
2. **Keep messages short**: SMS has 160 character limit
3. **Include opt-out**: Provide STOP/UNSUBSCRIBE option
4. **Respect time zones**: Don't send messages at night
5. **Track costs**: Monitor SMS costs to avoid surprises
6. **Handle errors**: Always check `result.success`
7. **Validate numbers**: Verify phone numbers before sending

## Common Patterns

### Send Verification Code

```typescript
async function sendVerificationCode(phoneNumber: string, code: string) {
  const smsConnector = getSMSConnector();
  if (!smsConnector) return;

  await smsConnector.sendMessage({
    to: phoneNumber,
    message: `Your verification code is ${code}. Valid for 10 minutes.`,
    validityPeriod: 10,
    tags: ['verification', '2fa'],
  });
}
```

### Send Order Notification

```typescript
async function sendOrderNotification(order: Order) {
  const smsConnector = getSMSConnector();
  if (!smsConnector) return;

  await smsConnector.sendMessage({
    to: order.customerPhone,
    message: `Your order #${order.id} has been confirmed. Delivery in 30 mins.`,
    tags: ['order', 'notification'],
  });
}
```

### Send Bulk Alerts

```typescript
async function sendEmergencyAlert(users: User[], message: string) {
  const smsConnector = getSMSConnector();
  if (!smsConnector) return;

  const requests = users.map(user => ({
    to: user.phoneNumber,
    message,
    tags: ['alert', 'emergency'],
  }));

  const result = await smsConnector.sendBulk(requests);

  console.log(`Alert sent to ${result.successful} users`);
  if (result.failed > 0) {
    console.error(`Failed to send to ${result.failed} users`);
  }
}
```

## PII Protection

The connector automatically masks phone numbers in logs:

```
// Original: +61412345678
// Logged as: *******5678
```

This protects personally identifiable information while maintaining debuggability.

## Related Components

- **communications.config.ts**: SMS provider configuration
- **events**: Event bus for event-driven SMS
- **logger**: Structured logging with PII protection
- **validation**: Phone number validation

## Support

For issues or questions:
- Verify provider credentials are configured
- Check phone number format (E.164)
- Review SMS logs for error details
- Test with provider's test mode first
- Monitor costs to avoid budget overruns

## References

- [Twilio Documentation](https://www.twilio.com/docs/sms)
- [MessageBird Documentation](https://developers.messagebird.com/)
- [E.164 Phone Format](https://en.wikipedia.org/wiki/E.164)
- [SMS Best Practices](https://www.twilio.com/docs/sms/best-practices)
