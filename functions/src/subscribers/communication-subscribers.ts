/**
 * Communication Subscribers
 * Event-driven communication integrations
 */

import { eventBus, EventType } from '../utilities/events';
import { getSNSConnector } from '../utilities/sns-connector';
import { getEmailConnector } from '../utilities/email-connector';
import { getSMSConnector } from '../utilities/sms-connector';
import { getCRMConnector } from '../utilities/crm-connector';
import { logger } from '../utilities/logger';

/**
 * Initialize all communication event subscribers
 */
export function initializeCommunicationSubscribers(): void {
  // SNS Event Streaming
  initializeSNSPublisher();

  // Email Notifications
  initializeEmailNotifications();

  // SMS Notifications
  initializeSMSNotifications();

  // CRM Sync
  initializeCRMSync();

  logger.info('Communication subscribers initialized');
}

/**
 * SNS Publisher - Stream all domain events to external systems
 */
function initializeSNSPublisher(): void {
  const snsConnector = getSNSConnector();
  if (!snsConnector) {
    logger.debug('SNS connector disabled, skipping SNS publisher');
    return;
  }

  // Subscribe to all event types and stream to appropriate SNS topics
  Object.values(EventType).forEach((eventType) => {
    eventBus.subscribe(eventType, async (payload) => {
      try {
        const topic = determineEventTopic(eventType);
        if (topic) {
          await snsConnector.publishEvent(topic, {
            eventType,
            entityType: payload.entityType || 'unknown',
            entityId: payload.entityId || payload.id || 'unknown',
            data: payload,
            metadata: {
              timestamp: new Date(payload.timestamp || Date.now()),
              correlationId: payload.requestId || 'unknown',
              userId: payload.userId,
              source: 'backend-api',
              version: '1.0',
            },
          });
        }
      } catch (error) {
        logger.error('Failed to publish event to SNS', {
          eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
}

/**
 * Email Notifications - Send transactional emails based on events
 */
function initializeEmailNotifications(): void {
  const emailConnector = getEmailConnector();
  if (!emailConnector) {
    logger.debug('Email connector disabled, skipping email notifications');
    return;
  }

  // User created - Send welcome email
  eventBus.subscribe(EventType.USER_CREATED, async (payload) => {
    try {
      await emailConnector.sendTransactional({
        to: [{ email: payload.data?.email, name: payload.data?.displayName }],
        templateId: 'welcome-email',
        variables: {
          firstName: payload.data?.firstName || 'there',
          loginUrl: `${process.env.APP_URL}/login`,
        },
        tags: ['welcome', 'transactional'],
      });
    } catch (error) {
      logger.error('Failed to send welcome email', { error });
    }
  });

  // Add more email event handlers here as needed
}

/**
 * SMS Notifications - Send SMS based on events
 */
function initializeSMSNotifications(): void {
  const smsConnector = getSMSConnector();
  if (!smsConnector) {
    logger.debug('SMS connector disabled, skipping SMS notifications');
    return;
  }

  // Example: Phone verification
  // eventBus.subscribe('PHONE_VERIFICATION_REQUESTED', async (payload) => {
  //   await smsConnector.sendMessage({
  //     to: payload.phoneNumber,
  //     message: `Your verification code is: ${payload.code}`,
  //     tags: ['verification'],
  //   });
  // });
}

/**
 * CRM Sync - Sync data to CRM systems
 */
function initializeCRMSync(): void {
  const crmConnector = getCRMConnector();
  if (!crmConnector) {
    logger.debug('CRM connector disabled, skipping CRM sync');
    return;
  }

  // User created - Create contact in CRM
  eventBus.subscribe(EventType.USER_CREATED, async (payload) => {
    try {
      await crmConnector.createContact({
        email: payload.data?.email || '',
        firstName: payload.data?.firstName,
        lastName: payload.data?.lastName,
        source: 'web_app',
        customFields: {
          signup_date: payload.timestamp,
          user_role: payload.data?.role,
        },
        tags: ['new-user'],
      });
    } catch (error) {
      logger.error('Failed to sync user to CRM', { error });
    }
  });

  // Add more CRM sync handlers here
}

/**
 * Determine which SNS topic to use for an event
 */
function determineEventTopic(eventType: EventType): string | null {
  // Map event types to SNS topics
  const userEvents = [EventType.USER_CREATED];

  if (userEvents.includes(eventType)) {
    return process.env.SNS_USER_EVENTS_TOPIC || null;
  }

  // Add more topic mappings as needed
  return process.env.SNS_SYSTEM_EVENTS_TOPIC || null;
}
