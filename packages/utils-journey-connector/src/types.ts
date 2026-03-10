/**
 * Journey Connector Types
 * Marketing automation and customer journey management
 */

/**
 * Contact/Person in marketing automation system
 */
export interface JourneyContact {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  customFields?: Record<string, any>;
  tags?: string[];
  lists?: string[];
}

/**
 * Journey/Campaign enrollment
 */
export interface JourneyEnrollment {
  journeyId: string;
  contacts: JourneyContact[];
  data?: Record<string, any>;
}

/**
 * Track custom activity/event
 */
export interface ActivityEvent {
  email: string;
  activityId: string;
  timestamp?: Date;
  data?: Record<string, any>;
}

/**
 * List subscription
 */
export interface ListSubscription {
  email: string;
  listId: string;
  customFields?: Record<string, any>;
}

/**
 * Journey segment
 */
export interface JourneySegment {
  id: string;
  name: string;
  description?: string;
  conditions: any; // Provider-specific conditions
}

/**
 * Journey/Campaign
 */
export interface Journey {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  type?: 'email' | 'sms' | 'multi-channel';
  enrolledCount?: number;
  completedCount?: number;
}

/**
 * Journey response
 */
export interface JourneyResponse {
  success: boolean;
  message?: string;
  contactIds?: string[];
  errors?: Array<{
    email: string;
    error: string;
  }>;
}
