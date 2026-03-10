/**
 * CRM Connector Types
 */

export interface CRMContact {
  id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  customFields?: Record<string, any>;
  tags?: string[];
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CRMCompany {
  id?: string;
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  customFields?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CRMDeal {
  id?: string;
  name: string;
  amount?: number;
  stage?: string;
  contactId?: string;
  companyId?: string;
  closeDate?: Date;
  probability?: number;
  customFields?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CRMActivity {
  id?: string;
  contactId?: string;
  contactEmail?: string;
  type: string;
  subject: string;
  description?: string;
  timestamp?: Date;
  customFields?: Record<string, any>;
}

export interface CRMResult<T> {
  success: boolean;
  data?: T;
  error?: CRMError;
}

export interface CRMError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ContactSearchQuery {
  email?: string;
  name?: string;
  company?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export type CRMObjectType = 'contact' | 'company' | 'deal' | 'activity';

export interface CustomField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum';
  options?: string[];
  required?: boolean;
}

export interface CreateCustomFieldRequest {
  objectType: CRMObjectType;
  name: string;
  label: string;
  type: CustomField['type'];
  options?: string[];
}
