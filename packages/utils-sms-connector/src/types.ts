/**
 * SMS Connector Types
 */

export interface SMSRequest {
  to: string; // Phone number in E.164 format
  message: string;
  from?: string;
  mediaUrls?: string[];
  validityPeriod?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  cost?: number;
  error?: SMSError;
  provider: string;
  timestamp: Date;
}

export interface BulkSMSResult {
  success: boolean;
  successful: number;
  failed: number;
  results: SMSResult[];
  totalCost?: number;
  timestamp: Date;
}

export interface SMSError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface MessageStatus {
  messageId: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered';
  to: string;
  from: string;
  body: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: Date;
}

export interface DeliveryReport {
  messageId: string;
  delivered: boolean;
  deliveredAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}
