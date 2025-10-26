/**
 * Communication Utilities Usage Examples
 * Demonstrates how to use SNS, Email, SMS, and CRM connectors
 */

import {
  getSNSConnector,
  getEmailConnector,
  getSMSConnector,
  getCRMConnector,
} from '../functions/src/utilities';

/**
 * Example 1: Publish event to SNS
 */
export async function exampleSNSPublish() {
  const snsConnector = getSNSConnector();
  if (!snsConnector) {
    console.log('SNS connector not configured');
    return;
  }

  await snsConnector.publishEvent(
    process.env.SNS_USER_EVENTS_TOPIC!,
    {
      eventType: 'USER_REGISTERED',
      entityType: 'User',
      entityId: 'user-123',
      data: {
        email: 'user@example.com',
        name: 'John Doe',
      },
      metadata: {
        timestamp: new Date(),
        correlationId: 'req-456',
        userId: 'user-123',
        source: 'web-app',
        version: '1.0',
      },
    }
  );
}

/**
 * Example 2: Send transactional email
 */
export async function exampleSendWelcomeEmail() {
  const emailConnector = getEmailConnector();
  if (!emailConnector) {
    console.log('Email connector not configured');
    return;
  }

  await emailConnector.sendTransactional({
    to: [
      {
        email: 'user@example.com',
        name: 'John Doe',
      },
    ],
    templateId: 'welcome-email',
    variables: {
      firstName: 'John',
      activationLink: 'https://app.example.com/activate/token123',
    },
    tags: ['welcome', 'onboarding'],
  });
}

/**
 * Example 3: Send verification SMS
 */
export async function exampleSendVerificationSMS() {
  const smsConnector = getSMSConnector();
  if (!smsConnector) {
    console.log('SMS connector not configured');
    return;
  }

  const verificationCode = '123456';

  await smsConnector.sendMessage({
    to: '+1234567890',
    message: `Your verification code is: ${verificationCode}. Valid for 10 minutes.`,
    validityPeriod: 600, // 10 minutes
    tags: ['verification', 'auth'],
  });
}

/**
 * Example 4: Sync user to CRM
 */
export async function exampleSyncUserToCRM() {
  const crmConnector = getCRMConnector();
  if (!crmConnector) {
    console.log('CRM connector not configured');
    return;
  }

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
      referral_source: 'organic',
    },
    tags: ['new-user', 'premium'],
    source: 'web_app',
  });
}

/**
 * Example 5: Log activity in CRM
 */
export async function exampleLogCRMActivity() {
  const crmConnector = getCRMConnector();
  if (!crmConnector) return;

  await crmConnector.logActivity({
    contactEmail: 'user@example.com',
    type: 'purchase',
    subject: 'Premium Plan Purchase',
    description: 'User upgraded to premium plan for $99/month',
    timestamp: new Date(),
    customFields: {
      plan_name: 'Premium',
      plan_price: 99,
      billing_cycle: 'monthly',
    },
  });
}

/**
 * Example 6: Event-driven communication flow
 * This shows how the event bus automatically triggers communications
 */
export async function exampleEventDrivenFlow() {
  // When a USER_CREATED event is published to the event bus,
  // the communication subscribers automatically:
  // 1. Stream the event to SNS
  // 2. Send a welcome email
  // 3. Create a contact in CRM

  // No manual connector calls needed - just publish the event!
  // See: functions/src/subscribers/communication-subscribers.ts
}

/**
 * Example 7: Bulk operations
 */
export async function exampleBulkOperations() {
  const emailConnector = getEmailConnector();
  if (!emailConnector) return;

  const users = [
    { email: 'user1@example.com', name: 'User 1' },
    { email: 'user2@example.com', name: 'User 2' },
    { email: 'user3@example.com', name: 'User 3' },
  ];

  await emailConnector.sendBulk({
    emails: users.map((user) => ({
      to: [user],
      subject: 'Product Update',
      htmlContent: '<h1>New Features Available!</h1>',
      tags: ['product-update', 'marketing'],
    })),
    batchSize: 50,
  });
}
