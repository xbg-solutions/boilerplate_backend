/**
 * Journey Connector
 * Marketing automation and customer journey management
 */

import {
  JourneyContact,
  JourneyEnrollment,
  ActivityEvent,
  ListSubscription,
  JourneySegment,
  Journey,
  JourneyResponse,
} from './types';
import { logger } from '../logger';

/**
 * Journey Provider Interface
 */
export interface JourneyProvider {
  /**
   * Create or update a contact
   */
  upsertContact(contact: JourneyContact): Promise<JourneyResponse>;

  /**
   * Enroll contacts in a journey/campaign
   */
  enrollInJourney(enrollment: JourneyEnrollment): Promise<JourneyResponse>;

  /**
   * Remove contact from journey
   */
  unenrollFromJourney(journeyId: string, email: string): Promise<JourneyResponse>;

  /**
   * Track custom activity/event
   */
  trackActivity(event: ActivityEvent): Promise<JourneyResponse>;

  /**
   * Subscribe to list
   */
  subscribeToList(subscription: ListSubscription): Promise<JourneyResponse>;

  /**
   * Unsubscribe from list
   */
  unsubscribeFromList(listId: string, email: string): Promise<JourneyResponse>;

  /**
   * Get available journeys
   */
  getJourneys(): Promise<Journey[]>;

  /**
   * Get segments
   */
  getSegments(): Promise<JourneySegment[]>;

  /**
   * Add tags to contact
   */
  addTags(email: string, tags: string[]): Promise<JourneyResponse>;

  /**
   * Remove tags from contact
   */
  removeTags(email: string, tags: string[]): Promise<JourneyResponse>;
}

/**
 * Journey Connector
 * Unified interface for marketing automation platforms
 */
export class JourneyConnector {
  private provider: JourneyProvider;

  constructor(provider: JourneyProvider) {
    this.provider = provider;
  }

  /**
   * Create or update a contact
   */
  async upsertContact(contact: JourneyContact): Promise<JourneyResponse> {
    logger.info('Upserting contact in journey system', {
      email: contact.email,
    });

    try {
      const response = await this.provider.upsertContact(contact);

      if (response.success) {
        logger.info('Contact upserted successfully');
      } else {
        logger.warn('Failed to upsert contact', { errors: response.errors });
      }

      return response;
    } catch (error) {
      logger.error('Error upserting contact', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Enroll contacts in a journey/campaign
   */
  async enrollInJourney(enrollment: JourneyEnrollment): Promise<JourneyResponse> {
    logger.info('Enrolling contacts in journey', {
      journeyId: enrollment.journeyId,
      contactCount: enrollment.contacts.length,
    });

    try {
      const response = await this.provider.enrollInJourney(enrollment);

      logger.info('Journey enrollment completed', {
        success: response.success,
        enrolledCount: response.contactIds?.length,
      });

      return response;
    } catch (error) {
      logger.error('Error enrolling in journey', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove contact from journey
   */
  async unenrollFromJourney(journeyId: string, email: string): Promise<JourneyResponse> {
    logger.info('Unenrolling contact from journey', {
      journeyId,
      email,
    });

    try {
      return await this.provider.unenrollFromJourney(journeyId, email);
    } catch (error) {
      logger.error('Error unenrolling from journey', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Track custom activity/event
   */
  async trackActivity(event: ActivityEvent): Promise<JourneyResponse> {
    logger.info('Tracking activity', {
      email: event.email,
      activityId: event.activityId,
    });

    try {
      return await this.provider.trackActivity(event);
    } catch (error) {
      logger.error('Error tracking activity', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Subscribe contact to list
   */
  async subscribeToList(subscription: ListSubscription): Promise<JourneyResponse> {
    logger.info('Subscribing to list', {
      email: subscription.email,
      listId: subscription.listId,
    });

    try {
      return await this.provider.subscribeToList(subscription);
    } catch (error) {
      logger.error('Error subscribing to list', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Unsubscribe contact from list
   */
  async unsubscribeFromList(listId: string, email: string): Promise<JourneyResponse> {
    logger.info('Unsubscribing from list', {
      email,
      listId,
    });

    try {
      return await this.provider.unsubscribeFromList(listId, email);
    } catch (error) {
      logger.error('Error unsubscribing from list', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all available journeys
   */
  async getJourneys(): Promise<Journey[]> {
    try {
      return await this.provider.getJourneys();
    } catch (error) {
      logger.error('Error fetching journeys', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all segments
   */
  async getSegments(): Promise<JourneySegment[]> {
    try {
      return await this.provider.getSegments();
    } catch (error) {
      logger.error('Error fetching segments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add tags to contact
   */
  async addTags(email: string, tags: string[]): Promise<JourneyResponse> {
    logger.info('Adding tags to contact', {
      email,
      tags,
    });

    try {
      return await this.provider.addTags(email, tags);
    } catch (error) {
      logger.error('Error adding tags', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove tags from contact
   */
  async removeTags(email: string, tags: string[]): Promise<JourneyResponse> {
    logger.info('Removing tags from contact', {
      email,
      tags,
    });

    try {
      return await this.provider.removeTags(email, tags);
    } catch (error) {
      logger.error('Error removing tags', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
