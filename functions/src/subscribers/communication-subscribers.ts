/**
 * Communication Subscribers
 * Event-driven communication integrations
 */

import { eventBus, EventType } from '../utilities/events';
import { getEmailConnector } from '../utilities/email-connector';
import { getSMSConnector } from '../utilities/sms-connector';
import { getCRMConnector } from '../utilities/crm-connector';
import { getRealtimeConnector } from '../utilities/realtime-connector';
import { logger } from '../utilities/logger';

/**
 * Initialize all communication event subscribers
 */
export function initializeCommunicationSubscribers(): void {
  // Email Notifications
  initializeEmailNotifications();

  // SMS Notifications
  initializeSMSNotifications();

  // CRM Sync
  initializeCRMSync();

  // Realtime Updates
  initializeRealtimeUpdates();

  logger.info('Communication subscribers initialized');
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
 * Realtime Updates - Broadcast events to connected clients
 */
function initializeRealtimeUpdates(): void {
  const realtimeConnector = getRealtimeConnector();
  if (!realtimeConnector) {
    logger.debug('Realtime connector disabled, skipping realtime updates');
    return;
  }

  // Broadcast important events to connected clients
  Object.values(EventType).forEach((eventType) => {
    eventBus.subscribe(eventType, async (payload) => {
      try {
        await realtimeConnector.broadcast({
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: eventType,
          data: payload,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error('Failed to broadcast realtime update', {
          eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
}
