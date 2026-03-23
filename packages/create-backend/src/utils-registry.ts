/**
 * Registry of available @xbg.solutions/utils-* packages
 * Used by the CLI to offer utility selection during project init/sync
 */

export interface UtilityDefinition {
  name: string;
  package: string;
  description: string;
  category: 'core' | 'data' | 'communication' | 'integration' | 'security' | 'infrastructure';
  alwaysIncluded?: boolean;
  envVars?: string[];
}

export const UTILITY_REGISTRY: UtilityDefinition[] = [
  // Core utilities (always included with @xbg.solutions/backend-core)
  {
    name: 'Logger',
    package: '@xbg.solutions/utils-logger',
    description: 'Structured logging with PII sanitization',
    category: 'core',
    alwaysIncluded: true,
  },
  {
    name: 'Events',
    package: '@xbg.solutions/utils-events',
    description: 'Event bus for domain events',
    category: 'core',
    alwaysIncluded: true,
  },
  {
    name: 'Errors',
    package: '@xbg.solutions/utils-errors',
    description: 'Custom error classes',
    category: 'core',
    alwaysIncluded: true,
  },

  // Data utilities
  {
    name: 'Firestore Connector',
    package: '@xbg.solutions/utils-firestore-connector',
    description: 'Multi-database Firestore access and Firebase Admin SDK init',
    category: 'data',
    alwaysIncluded: true,
  },
  {
    name: 'Cache Connector',
    package: '@xbg.solutions/utils-cache-connector',
    description: 'Multi-provider caching (memory, Firestore, Redis)',
    category: 'data',
    envVars: ['CACHE_ENABLED', 'CACHE_DEFAULT_PROVIDER', 'CACHE_DEFAULT_TTL'],
  },
  {
    name: 'Firebase Event Bridge',
    package: '@xbg.solutions/utils-firebase-event-bridge',
    description: 'Firebase triggers to domain event normalization',
    category: 'data',
  },

  // Communication utilities
  {
    name: 'Email Connector',
    package: '@xbg.solutions/utils-email-connector',
    description: 'Email sending with Mailjet and Ortto providers',
    category: 'communication',
    envVars: ['EMAIL_ENABLED', 'EMAIL_PROVIDER', 'MAILJET_API_KEY', 'MAILJET_SECRET_KEY'],
  },
  {
    name: 'SMS Connector',
    package: '@xbg.solutions/utils-sms-connector',
    description: 'SMS sending with Twilio and MessageBird providers',
    category: 'communication',
    envVars: ['SMS_ENABLED', 'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  },
  {
    name: 'Push Notifications',
    package: '@xbg.solutions/utils-push-notifications-connector',
    description: 'Push notifications via Firebase Cloud Messaging',
    category: 'communication',
  },
  {
    name: 'Realtime Connector',
    package: '@xbg.solutions/utils-realtime-connector',
    description: 'SSE and WebSocket providers',
    category: 'communication',
  },

  // Integration utilities
  {
    name: 'CRM Connector',
    package: '@xbg.solutions/utils-crm-connector',
    description: 'CRM integration with HubSpot and Salesforce',
    category: 'integration',
    envVars: ['CRM_ENABLED', 'CRM_PROVIDER', 'HUBSPOT_API_KEY'],
  },
  {
    name: 'LLM Connector',
    package: '@xbg.solutions/utils-llm-connector',
    description: 'LLM integration with OpenAI, Claude, and Gemini',
    category: 'integration',
  },
  {
    name: 'ERP Connector',
    package: '@xbg.solutions/utils-erp-connector',
    description: 'ERP integration with Workday',
    category: 'integration',
  },
  {
    name: 'Journey Connector',
    package: '@xbg.solutions/utils-journey-connector',
    description: 'Customer journey integration with Ortto',
    category: 'integration',
  },
  {
    name: 'Survey Connector',
    package: '@xbg.solutions/utils-survey-connector',
    description: 'Survey integration',
    category: 'integration',
  },
  {
    name: 'Work Mgmt Connector',
    package: '@xbg.solutions/utils-work-mgmt-connector',
    description: 'Work management with Notion and Asana',
    category: 'integration',
  },
  {
    name: 'Document Connector',
    package: '@xbg.solutions/utils-document-connector',
    description: 'Document processing',
    category: 'integration',
  },

  // Security utilities
  {
    name: 'Token Handler',
    package: '@xbg.solutions/utils-token-handler',
    description: 'JWT generation, verification, and blacklist management',
    category: 'security',
    envVars: ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_EXPIRES_IN', 'TOKEN_BLACKLIST_ENABLED'],
  },
  {
    name: 'Hashing',
    package: '@xbg.solutions/utils-hashing',
    description: 'PII encryption with AES-256-GCM',
    category: 'security',
    envVars: ['PII_ENCRYPTION_KEY'],
  },
  {
    name: 'Validation',
    package: '@xbg.solutions/utils-validation',
    description: 'Input validation with Joi and express-validator',
    category: 'security',
  },

  // Infrastructure utilities
  {
    name: 'Timezone',
    package: '@xbg.solutions/utils-timezone',
    description: 'Timezone conversion helper',
    category: 'infrastructure',
  },
  {
    name: 'Address Validation',
    package: '@xbg.solutions/utils-address-validation',
    description: 'Google Maps address validation',
    category: 'infrastructure',
    envVars: ['GOOGLE_MAPS_API_KEY'],
  },
];

/**
 * Get utilities that are always included
 */
export function getRequiredUtilities(): UtilityDefinition[] {
  return UTILITY_REGISTRY.filter((u) => u.alwaysIncluded);
}

/**
 * Get utilities available for selection
 */
export function getOptionalUtilities(): UtilityDefinition[] {
  return UTILITY_REGISTRY.filter((u) => !u.alwaysIncluded);
}

/**
 * Get utilities grouped by category
 */
export function getUtilitiesByCategory(): Record<string, UtilityDefinition[]> {
  const grouped: Record<string, UtilityDefinition[]> = {};
  for (const util of UTILITY_REGISTRY) {
    if (!grouped[util.category]) {
      grouped[util.category] = [];
    }
    grouped[util.category].push(util);
  }
  return grouped;
}
