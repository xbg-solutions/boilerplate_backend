/**
 * Ortto Provider for Journey Connector
 * https://help.ortto.com/developer/latest/
 */

import { JourneyProvider } from '../journey-connector';
import {
  JourneyContact,
  JourneyEnrollment,
  ActivityEvent,
  ListSubscription,
  JourneySegment,
  Journey,
  JourneyResponse,
} from '../types';

export interface OrttoProviderConfig {
  apiKey: string;
  region?: 'us' | 'au' | 'eu'; // Ortto has regional instances
}

export class OrttoProvider implements JourneyProvider {
  private baseURL: string;
  private headers: Record<string, string>;

  constructor(config: OrttoProviderConfig) {
    this.baseURL = this.getBaseURL(config.region || 'us');
    this.headers = {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private getBaseURL(region: string): string {
    const regionMap: Record<string, string> = {
      us: 'https://api.ortto.com',
      au: 'https://api.ap-southeast-2.ortto.com',
      eu: 'https://api.eu-west-1.ortto.com',
    };
    return regionMap[region] || regionMap.us;
  }

  private async request<T = any>(path: string, options: {
    method?: string;
    body?: any;
    params?: Record<string, any>;
  } = {}): Promise<{ data: T }> {
    const { method = 'GET', body, params } = options;
    let url = `${this.baseURL}${path}`;
    if (params) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.append(key, String(value));
      }
      const qs = query.toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => undefined);
      const error: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      error.response = { status: res.status, data: errorData };
      throw error;
    }
    const data = await res.json();
    return { data };
  }

  /**
   * Create or update a contact in Ortto
   */
  async upsertContact(contact: JourneyContact): Promise<JourneyResponse> {
    try {
      const payload = {
        contacts: [
          {
            fields: {
              'str::email': contact.email,
              'str::first': contact.firstName,
              'str::last': contact.lastName,
              'phn::phone': contact.phone,
              ...this.mapCustomFields(contact.customFields),
            },
            tags: contact.tags,
          },
        ],
        merge_by: ['str::email'],
      };

      const response = await this.request('/v1/person/merge', { method: 'POST', body: payload });

      return {
        success: true,
        contactIds: response.data?.contacts?.map((c: any) => c.id),
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Enroll contacts in a journey (campaign)
   */
  async enrollInJourney(enrollment: JourneyEnrollment): Promise<JourneyResponse> {
    try {
      // First, upsert all contacts
      const contacts = enrollment.contacts.map(c => ({
        fields: {
          'str::email': c.email,
          'str::first': c.firstName,
          'str::last': c.lastName,
          ...this.mapCustomFields(c.customFields),
        },
      }));

      await this.request('/v1/person/merge', {
        method: 'POST',
        body: {
          contacts,
          merge_by: ['str::email'],
        },
      });

      // Then add them to the campaign
      const campaignPayload = {
        campaign_id: enrollment.journeyId,
        contacts: enrollment.contacts.map(c => ({
          email: c.email,
        })),
      };

      await this.request('/v1/campaigns/enroll', { method: 'POST', body: campaignPayload });

      return {
        success: true,
        message: `Enrolled ${enrollment.contacts.length} contacts in journey`,
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email: '',
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Remove contact from journey
   */
  async unenrollFromJourney(journeyId: string, email: string): Promise<JourneyResponse> {
    try {
      await this.request('/v1/campaigns/unenroll', {
        method: 'POST',
        body: {
          campaign_id: journeyId,
          contacts: [{ email }],
        },
      });

      return {
        success: true,
        message: 'Contact unenrolled from journey',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Track custom activity
   */
  async trackActivity(event: ActivityEvent): Promise<JourneyResponse> {
    try {
      const payload = {
        activities: [
          {
            activity_id: event.activityId,
            attributes: {
              'str::email': event.email,
              ...this.mapCustomFields(event.data),
            },
            timestamp: event.timestamp || new Date(),
          },
        ],
      };

      await this.request('/v1/activities', { method: 'POST', body: payload });

      return {
        success: true,
        message: 'Activity tracked successfully',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email: event.email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Subscribe to list
   */
  async subscribeToList(subscription: ListSubscription): Promise<JourneyResponse> {
    try {
      // In Ortto, lists are managed through tags
      const payload = {
        contacts: [
          {
            fields: {
              'str::email': subscription.email,
              ...this.mapCustomFields(subscription.customFields),
            },
            tags: [`list:${subscription.listId}`],
          },
        ],
        merge_by: ['str::email'],
      };

      await this.request('/v1/person/merge', { method: 'POST', body: payload });

      return {
        success: true,
        message: 'Subscribed to list successfully',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email: subscription.email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Unsubscribe from list
   */
  async unsubscribeFromList(listId: string, email: string): Promise<JourneyResponse> {
    try {
      // Remove the list tag
      await this.request('/v1/person/tags/remove', {
        method: 'POST',
        body: {
          email,
          tags: [`list:${listId}`],
        },
      });

      return {
        success: true,
        message: 'Unsubscribed from list successfully',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Get available journeys (campaigns)
   */
  async getJourneys(): Promise<Journey[]> {
    try {
      const response = await this.request('/v1/campaigns');

      return response.data?.campaigns?.map((campaign: any) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        type: campaign.type,
        enrolledCount: campaign.enrolled_count,
        completedCount: campaign.completed_count,
      })) || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get segments
   */
  async getSegments(): Promise<JourneySegment[]> {
    try {
      const response = await this.request('/v1/segments');

      return response.data?.segments?.map((segment: any) => ({
        id: segment.id,
        name: segment.name,
        description: segment.description,
        conditions: segment.conditions,
      })) || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Add tags to contact
   */
  async addTags(email: string, tags: string[]): Promise<JourneyResponse> {
    try {
      await this.request('/v1/person/tags/add', {
        method: 'POST',
        body: {
          email,
          tags,
        },
      });

      return {
        success: true,
        message: 'Tags added successfully',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Remove tags from contact
   */
  async removeTags(email: string, tags: string[]): Promise<JourneyResponse> {
    try {
      await this.request('/v1/person/tags/remove', {
        method: 'POST',
        body: {
          email,
          tags,
        },
      });

      return {
        success: true,
        message: 'Tags removed successfully',
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          email,
          error: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  /**
   * Map custom fields to Ortto format
   */
  private mapCustomFields(fields?: Record<string, any>): Record<string, any> {
    if (!fields) return {};

    // Ortto uses typed field prefixes: str::, int::, dtz::, etc.
    const mapped: Record<string, any> = {};

    for (const [key, value] of Object.entries(fields)) {
      const type = typeof value;
      let prefix = 'str';

      if (type === 'number') {
        prefix = Number.isInteger(value) ? 'int' : 'dec';
      } else if (type === 'boolean') {
        prefix = 'bol';
      } else if (value instanceof Date) {
        prefix = 'dtz';
      }

      mapped[`${prefix}::${key}`] = value;
    }

    return mapped;
  }
}
