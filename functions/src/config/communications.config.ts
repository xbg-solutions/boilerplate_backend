/**
 * Communications Configuration
 * Settings for Email, SMS, CRM, Realtime, Push Notifications, Journeys, ERP, Work Management, Survey, and Document integrations
 */

export interface CommunicationsConfig {
  email: EmailConfig;
  sms: SMSConfig;
  crm: CRMConfig;
  realtime: RealtimeConfig;
  pushNotifications: PushNotificationsConfig;
  journey: JourneyConfig;
  erp: ERPConfig;
  workManagement: WorkManagementConfig;
  survey: SurveyConfig;
  document: DocumentConfig;
}

export interface EmailConfig {
  enabled: boolean;
  provider: 'mailjet' | 'ortto';
  fromAddress: string;
  fromName: string;
  providers: {
    mailjet?: {
      apiKey: string;
      secretKey: string;
    };
    ortto?: {
      apiKey: string;
      region?: string;
    };
  };
  defaults: {
    replyTo?: string;
    trackOpens: boolean;
    trackClicks: boolean;
  };
}

export interface SMSConfig {
  enabled: boolean;
  provider: 'twilio' | 'messagebird';
  providers: {
    twilio?: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
    };
    messagebird?: {
      apiKey: string;
      originator: string;
    };
  };
  defaults: {
    validityPeriod: number;
    enableDeliveryReports: boolean;
  };
}

export interface CRMConfig {
  enabled: boolean;
  provider: 'hubspot' | 'salesforce' | 'attio';
  syncOnEvents: string[];
  providers: {
    hubspot?: {
      apiKey: string;
    };
    salesforce?: {
      clientId: string;
      clientSecret: string;
      loginUrl: string;
      apiVersion: string;
    };
    attio?: {
      apiKey: string;
    };
  };
  sync: {
    batchSize: number;
    retryAttempts: number;
    retryDelay: number;
  };
}

export interface RealtimeConfig {
  enabled: boolean;
  provider: 'sse' | 'websocket';
  providers: {
    sse?: {
      heartbeatInterval: number;
      reconnectDelay: number;
    };
    websocket?: {
      port: number;
      path: string;
      pingInterval: number;
      pongTimeout: number;
    };
  };
}

export interface PushNotificationsConfig {
  enabled: boolean;
  provider: 'fcm';
  providers: {
    fcm?: {
      projectId: string;
      serviceAccountPath?: string;
    };
  };
}

export interface JourneyConfig {
  enabled: boolean;
  provider: 'ortto';
  providers: {
    ortto?: {
      apiKey: string;
      region?: string;
    };
  };
}

export interface ERPConfig {
  enabled: boolean;
  provider: 'workday';
  providers: {
    workday?: {
      tenant: string;
      clientId: string;
      clientSecret: string;
      apiVersion: string;
    };
  };
}

export interface WorkManagementConfig {
  enabled: boolean;
  provider: 'clickup' | 'monday' | 'notion';
  providers: {
    clickup?: {
      apiKey: string;
      teamId?: string;
    };
    monday?: {
      apiKey: string;
    };
    notion?: {
      apiKey: string;
      databaseId?: string;
    };
  };
}

export interface SurveyConfig {
  enabled: boolean;
  provider: 'surveymonkey' | 'typeform';
  providers: {
    surveymonkey?: {
      apiKey: string;
    };
    typeform?: {
      apiKey: string;
    };
  };
}

export interface DocumentConfig {
  enabled: boolean;
  provider: 'pandadoc';
  providers: {
    pandadoc?: {
      apiKey: string;
    };
  };
}

export const COMMUNICATIONS_CONFIG: CommunicationsConfig = {
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    provider: (process.env.EMAIL_PROVIDER as 'mailjet' | 'ortto') || 'mailjet',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Application',
    providers: {
      mailjet: {
        apiKey: process.env.MAILJET_API_KEY || '',
        secretKey: process.env.MAILJET_SECRET_KEY || '',
      },
      ortto: {
        apiKey: process.env.ORTTO_API_KEY || '',
        region: process.env.ORTTO_REGION || 'us',
      },
    },
    defaults: {
      replyTo: process.env.EMAIL_REPLY_TO,
      trackOpens: process.env.EMAIL_TRACK_OPENS !== 'false',
      trackClicks: process.env.EMAIL_TRACK_CLICKS !== 'false',
    },
  },

  sms: {
    enabled: process.env.SMS_ENABLED === 'true',
    provider: (process.env.SMS_PROVIDER as 'twilio' | 'messagebird') || 'twilio',
    providers: {
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_FROM_NUMBER || '',
      },
      messagebird: {
        apiKey: process.env.MESSAGEBIRD_API_KEY || '',
        originator: process.env.MESSAGEBIRD_ORIGINATOR || '',
      },
    },
    defaults: {
      validityPeriod: 3600,
      enableDeliveryReports: true,
    },
  },

  crm: {
    enabled: process.env.CRM_ENABLED === 'true',
    provider: (process.env.CRM_PROVIDER as 'hubspot' | 'salesforce' | 'attio') || 'hubspot',
    syncOnEvents: process.env.CRM_SYNC_EVENTS?.split(',') || ['USER_CREATED', 'ORDER_COMPLETED'],
    providers: {
      hubspot: {
        apiKey: process.env.HUBSPOT_API_KEY || '',
      },
      salesforce: {
        clientId: process.env.SALESFORCE_CLIENT_ID || '',
        clientSecret: process.env.SALESFORCE_CLIENT_SECRET || '',
        loginUrl: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com',
        apiVersion: process.env.SALESFORCE_API_VERSION || '58.0',
      },
      attio: {
        apiKey: process.env.ATTIO_API_KEY || '',
      },
    },
    sync: {
      batchSize: parseInt(process.env.CRM_BATCH_SIZE || '100', 10),
      retryAttempts: parseInt(process.env.CRM_RETRY_ATTEMPTS || '3', 10),
      retryDelay: parseInt(process.env.CRM_RETRY_DELAY || '1000', 10),
    },
  },

  realtime: {
    enabled: process.env.REALTIME_ENABLED === 'true',
    provider: (process.env.REALTIME_PROVIDER as 'sse' | 'websocket') || 'sse',
    providers: {
      sse: {
        heartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || '30000', 10),
        reconnectDelay: parseInt(process.env.SSE_RECONNECT_DELAY || '3000', 10),
      },
      websocket: {
        port: parseInt(process.env.WS_PORT || '8080', 10),
        path: process.env.WS_PATH || '/ws',
        pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000', 10),
        pongTimeout: parseInt(process.env.WS_PONG_TIMEOUT || '5000', 10),
      },
    },
  },

  pushNotifications: {
    enabled: process.env.PUSH_NOTIFICATIONS_ENABLED === 'true',
    provider: 'fcm',
    providers: {
      fcm: {
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH,
      },
    },
  },

  journey: {
    enabled: process.env.JOURNEY_ENABLED === 'true',
    provider: 'ortto',
    providers: {
      ortto: {
        apiKey: process.env.ORTTO_API_KEY || '',
        region: process.env.ORTTO_REGION || 'us',
      },
    },
  },

  erp: {
    enabled: process.env.ERP_ENABLED === 'true',
    provider: 'workday',
    providers: {
      workday: {
        tenant: process.env.WORKDAY_TENANT || '',
        clientId: process.env.WORKDAY_CLIENT_ID || '',
        clientSecret: process.env.WORKDAY_CLIENT_SECRET || '',
        apiVersion: process.env.WORKDAY_API_VERSION || 'v1',
      },
    },
  },

  workManagement: {
    enabled: process.env.WORK_MGMT_ENABLED === 'true',
    provider: (process.env.WORK_MGMT_PROVIDER as 'clickup' | 'monday' | 'notion') || 'clickup',
    providers: {
      clickup: {
        apiKey: process.env.CLICKUP_API_KEY || '',
        teamId: process.env.CLICKUP_TEAM_ID,
      },
      monday: {
        apiKey: process.env.MONDAY_API_KEY || '',
      },
      notion: {
        apiKey: process.env.NOTION_API_KEY || '',
        databaseId: process.env.NOTION_DATABASE_ID,
      },
    },
  },

  survey: {
    enabled: process.env.SURVEY_ENABLED === 'true',
    provider: (process.env.SURVEY_PROVIDER as 'surveymonkey' | 'typeform') || 'surveymonkey',
    providers: {
      surveymonkey: {
        apiKey: process.env.SURVEYMONKEY_API_KEY || '',
      },
      typeform: {
        apiKey: process.env.TYPEFORM_API_KEY || '',
      },
    },
  },

  document: {
    enabled: process.env.DOCUMENT_ENABLED === 'true',
    provider: 'pandadoc',
    providers: {
      pandadoc: {
        apiKey: process.env.PANDADOC_API_KEY || '',
      },
    },
  },
};

/**
 * Validate communications configuration
 */
export function validateCommunicationsConfig(): void {
  const errors: string[] = [];

  // Validate Email
  if (COMMUNICATIONS_CONFIG.email.enabled) {
    const provider = COMMUNICATIONS_CONFIG.email.provider;
    const providerConfig = COMMUNICATIONS_CONFIG.email.providers[provider];
    if (!providerConfig || !providerConfig.apiKey) {
      errors.push(`${provider.toUpperCase()} API key is required when email is enabled`);
    }
  }

  // Validate SMS
  if (COMMUNICATIONS_CONFIG.sms.enabled) {
    const provider = COMMUNICATIONS_CONFIG.sms.provider;
    const providerConfig = COMMUNICATIONS_CONFIG.sms.providers[provider];
    if (!providerConfig) {
      errors.push(`${provider.toUpperCase()} configuration is required when SMS is enabled`);
    }
  }

  // Validate CRM
  if (COMMUNICATIONS_CONFIG.crm.enabled) {
    const provider = COMMUNICATIONS_CONFIG.crm.provider;
    const providerConfig = COMMUNICATIONS_CONFIG.crm.providers[provider];
    if (!providerConfig || Object.values(providerConfig).every((v) => !v)) {
      errors.push(`${provider.toUpperCase()} configuration is required when CRM is enabled`);
    }
  }

  // Validate Push Notifications (FCM)
  if (COMMUNICATIONS_CONFIG.pushNotifications.enabled) {
    const fcm = COMMUNICATIONS_CONFIG.pushNotifications.providers.fcm;
    if (!fcm?.projectId) {
      errors.push('FIREBASE_PROJECT_ID is required when push notifications are enabled');
    }
  }

  // Validate Journey
  if (COMMUNICATIONS_CONFIG.journey.enabled) {
    const ortto = COMMUNICATIONS_CONFIG.journey.providers.ortto;
    if (!ortto?.apiKey) {
      errors.push('ORTTO_API_KEY is required when journey is enabled');
    }
  }

  // Validate ERP
  if (COMMUNICATIONS_CONFIG.erp.enabled) {
    const workday = COMMUNICATIONS_CONFIG.erp.providers.workday;
    if (!workday?.tenant || !workday?.clientId || !workday?.clientSecret) {
      errors.push('WORKDAY configuration (tenant, clientId, clientSecret) is required when ERP is enabled');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Communications configuration validation failed:\n${errors.join('\n')}`);
  }
}
