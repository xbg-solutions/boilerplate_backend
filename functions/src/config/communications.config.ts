/**
 * Communications Configuration
 * Settings for SNS, Email, SMS, and CRM integrations
 */

export interface CommunicationsConfig {
  sns: SNSConfig;
  email: EmailConfig;
  sms: SMSConfig;
  crm: CRMConfig;
}

export interface SNSConfig {
  enabled: boolean;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  topics: {
    userEvents?: string;
    orderEvents?: string;
    systemEvents?: string;
  };
  defaults: {
    messageRetentionPeriod: number;
    visibilityTimeout: number;
    deliveryDelay: number;
  };
}

export interface EmailConfig {
  enabled: boolean;
  provider: 'mailjet' | 'sendgrid';
  fromAddress: string;
  fromName: string;
  providers: {
    mailjet?: {
      apiKey: string;
      secretKey: string;
    };
    sendgrid?: {
      apiKey: string;
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
  provider: 'twilio' | 'aws-sns';
  providers: {
    twilio?: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
    };
    awsSns?: {
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
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

export const COMMUNICATIONS_CONFIG: CommunicationsConfig = {
  sns: {
    enabled: process.env.SNS_ENABLED === 'true',
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    topics: {
      userEvents: process.env.SNS_USER_EVENTS_TOPIC,
      orderEvents: process.env.SNS_ORDER_EVENTS_TOPIC,
      systemEvents: process.env.SNS_SYSTEM_EVENTS_TOPIC,
    },
    defaults: {
      messageRetentionPeriod: 1209600, // 14 days
      visibilityTimeout: 30,
      deliveryDelay: 0,
    },
  },

  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    provider: (process.env.EMAIL_PROVIDER as 'mailjet' | 'sendgrid') || 'mailjet',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Application',
    providers: {
      mailjet: {
        apiKey: process.env.MAILJET_API_KEY || '',
        secretKey: process.env.MAILJET_SECRET_KEY || '',
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY || '',
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
    provider: (process.env.SMS_PROVIDER as 'twilio' | 'aws-sns') || 'twilio',
    providers: {
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_FROM_NUMBER || '',
      },
      awsSns: {
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    },
    defaults: {
      validityPeriod: 3600, // 1 hour
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
};

/**
 * Validate communications configuration
 */
export function validateCommunicationsConfig(): void {
  const errors: string[] = [];

  // Validate SNS configuration
  if (COMMUNICATIONS_CONFIG.sns.enabled) {
    if (!COMMUNICATIONS_CONFIG.sns.accessKeyId) {
      errors.push('AWS_ACCESS_KEY_ID is required when SNS is enabled');
    }
    if (!COMMUNICATIONS_CONFIG.sns.secretAccessKey) {
      errors.push('AWS_SECRET_ACCESS_KEY is required when SNS is enabled');
    }
  }

  // Validate Email configuration
  if (COMMUNICATIONS_CONFIG.email.enabled) {
    const provider = COMMUNICATIONS_CONFIG.email.provider;
    if (provider === 'mailjet') {
      const mailjet = COMMUNICATIONS_CONFIG.email.providers.mailjet;
      if (!mailjet?.apiKey || !mailjet?.secretKey) {
        errors.push('MAILJET_API_KEY and MAILJET_SECRET_KEY are required when Mailjet is enabled');
      }
    } else if (provider === 'sendgrid') {
      const sendgrid = COMMUNICATIONS_CONFIG.email.providers.sendgrid;
      if (!sendgrid?.apiKey) {
        errors.push('SENDGRID_API_KEY is required when SendGrid is enabled');
      }
    }
  }

  // Validate SMS configuration
  if (COMMUNICATIONS_CONFIG.sms.enabled) {
    const provider = COMMUNICATIONS_CONFIG.sms.provider;
    if (provider === 'twilio') {
      const twilio = COMMUNICATIONS_CONFIG.sms.providers.twilio;
      if (!twilio?.accountSid || !twilio?.authToken) {
        errors.push('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required when Twilio is enabled');
      }
    }
  }

  // Validate CRM configuration
  if (COMMUNICATIONS_CONFIG.crm.enabled) {
    const provider = COMMUNICATIONS_CONFIG.crm.provider;
    const providerConfig = COMMUNICATIONS_CONFIG.crm.providers[provider];
    if (!providerConfig || Object.values(providerConfig).every((v) => !v)) {
      errors.push(`${provider.toUpperCase()} configuration is required when CRM is enabled`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Communications configuration validation failed:\n${errors.join('\n')}`);
  }
}
