/**
 * Document Connector Types
 * Document creation, management, and e-signature
 */

/**
 * Document status
 */
export type DocumentStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'completed'
  | 'voided'
  | 'declined'
  | 'expired';

/**
 * Document
 */
export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
  dateCreated?: Date;
  dateModified?: Date;
  dateCompleted?: Date;
  expirationDate?: Date;
  recipients?: DocumentRecipient[];
  url?: string;
  downloadUrl?: string;
}

/**
 * Document recipient
 */
export interface DocumentRecipient {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: 'signer' | 'approver' | 'cc';
  signedDate?: Date;
  viewedDate?: Date;
  status?: 'pending' | 'viewed' | 'completed' | 'declined';
}

/**
 * Create document request
 */
export interface CreateDocumentRequest {
  name: string;
  templateId?: string;
  recipients: DocumentRecipient[];
  fields?: Record<string, any>;
  expirationDate?: Date;
  message?: string;
}

/**
 * Send document request
 */
export interface SendDocumentRequest {
  documentId: string;
  message?: string;
  silent?: boolean; // Don't send email notifications
}

/**
 * Document template
 */
export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  fields?: Array<{
    name: string;
    type: string;
    required?: boolean;
  }>;
  createdAt?: Date;
}

/**
 * Download options
 */
export interface DownloadOptions {
  format?: 'pdf' | 'original';
  watermark?: boolean;
}

/**
 * Document field
 */
export interface DocumentField {
  name: string;
  value: any;
  type?: 'text' | 'signature' | 'date' | 'checkbox';
}

/**
 * Query options
 */
export interface DocumentQueryOptions {
  page?: number;
  limit?: number;
  status?: DocumentStatus;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * Response wrapper
 */
export interface DocumentResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
