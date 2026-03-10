/**
 * Custom error classes for adding metadata to errors
 */

/**
 * Base error class with requestId
 */
export class RequestError extends Error {
  public requestId?: string;
  public error?: any;

  constructor(message: string, requestId?: string, originalError?: any) {
    super(message);
    this.name = 'RequestError';
    this.requestId = requestId;
    this.error = originalError;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestError);
    }
  }
}

/**
 * Repository error with collection metadata
 */
export class RepositoryError extends Error {
  public collection?: string;

  constructor(message: string, collection?: string) {
    super(message);
    this.name = 'RepositoryError';
    this.collection = collection;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RepositoryError);
    }
  }
}

/**
 * Service error with requestId metadata
 */
export class ServiceError extends Error {
  public requestId?: string;

  constructor(message: string, requestId?: string) {
    super(message);
    this.name = 'ServiceError';
    this.requestId = requestId;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }
}

/**
 * Authentication error with error metadata
 */
export class AuthError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'AuthError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthError);
    }
  }
}

/**
 * Survey connector error with surveyId metadata
 */
export class SurveyError extends Error {
  public surveyId?: string;
  public responseId?: string;
  public error?: any;

  constructor(message: string, metadata?: { surveyId?: string; responseId?: string; error?: any }) {
    super(message);
    this.name = 'SurveyError';
    this.surveyId = metadata?.surveyId;
    this.responseId = metadata?.responseId;
    this.error = metadata?.error;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SurveyError);
    }
  }
}

/**
 * Work management connector error with taskId/articleId metadata
 */
export class WorkMgmtError extends Error {
  public taskId?: string;
  public articleId?: string;
  public error?: any;

  constructor(message: string, metadata?: { taskId?: string; articleId?: string; error?: any }) {
    super(message);
    this.name = 'WorkMgmtError';
    this.taskId = metadata?.taskId;
    this.articleId = metadata?.articleId;
    this.error = metadata?.error;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkMgmtError);
    }
  }
}

/**
 * Communication subscriber error with event metadata
 */
export class CommunicationError extends Error {
  public eventType?: string;
  public error?: any;

  constructor(message: string, metadata?: { eventType?: string; error?: any }) {
    super(message);
    this.name = 'CommunicationError';
    this.eventType = metadata?.eventType;
    this.error = metadata?.error;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CommunicationError);
    }
  }
}

/**
 * CRM connector error with error metadata
 */
export class CRMError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'CRMError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CRMError);
    }
  }
}

/**
 * Analytics connector error with error metadata
 */
export class AnalyticsError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'AnalyticsError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AnalyticsError);
    }
  }
}

/**
 * Email connector error with error metadata
 */
export class EmailError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'EmailError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EmailError);
    }
  }
}

/**
 * Payment connector error with error metadata
 */
export class PaymentError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'PaymentError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PaymentError);
    }
  }
}

/**
 * Search connector error with error metadata
 */
export class SearchError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'SearchError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SearchError);
    }
  }
}

/**
 * SMS connector error with error metadata
 */
export class SMSError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'SMSError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SMSError);
    }
  }
}

/**
 * Storage connector error with error metadata
 */
export class StorageError extends Error {
  public error?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'StorageError';
    this.error = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError);
    }
  }
}
