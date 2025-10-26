/**
 * CRM Connector
 * Syncs customer data with CRM systems
 */

import {
  CRMContact,
  CRMCompany,
  CRMDeal,
  CRMActivity,
  CRMResult,
  ContactSearchQuery,
  CRMObjectType,
  CustomField,
  CreateCustomFieldRequest,
} from './types';
import { logger } from '../logger';

export interface CRMProvider {
  createContact(contact: CRMContact): Promise<CRMResult<CRMContact>>;
  updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMResult<CRMContact>>;
  getContact(id: string): Promise<CRMResult<CRMContact>>;
  searchContacts(query: ContactSearchQuery): Promise<CRMResult<CRMContact[]>>;
  createCompany(company: CRMCompany): Promise<CRMResult<CRMCompany>>;
  updateCompany(id: string, updates: Partial<CRMCompany>): Promise<CRMResult<CRMCompany>>;
  createDeal(deal: CRMDeal): Promise<CRMResult<CRMDeal>>;
  updateDeal(id: string, updates: Partial<CRMDeal>): Promise<CRMResult<CRMDeal>>;
  logActivity(activity: CRMActivity): Promise<CRMResult<CRMActivity>>;
  getCustomFields(objectType: CRMObjectType): Promise<CustomField[]>;
  createCustomField(field: CreateCustomFieldRequest): Promise<CustomField>;
}

export class CRMConnector {
  private provider: CRMProvider;

  constructor(provider: CRMProvider) {
    this.provider = provider;
  }

  /**
   * Create contact in CRM
   */
  async createContact(contact: CRMContact): Promise<CRMResult<CRMContact>> {
    try {
      logger.info('Creating CRM contact', {
        email: contact.email,
        source: contact.source,
      });

      const result = await this.provider.createContact(contact);

      if (result.success) {
        logger.info('Contact created successfully', {
          id: result.data?.id,
        });
      } else {
        logger.warn('Failed to create contact', {
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
        });
      }

      return result;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update contact
   */
  async updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMResult<CRMContact>> {
    try {
      logger.info('Updating CRM contact', { id });
      return await this.provider.updateContact(id, updates);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get contact by ID
   */
  async getContact(id: string): Promise<CRMResult<CRMContact>> {
    try {
      return await this.provider.getContact(id);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Search contacts
   */
  async searchContacts(query: ContactSearchQuery): Promise<CRMResult<CRMContact[]>> {
    try {
      return await this.provider.searchContacts(query);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create company
   */
  async createCompany(company: CRMCompany): Promise<CRMResult<CRMCompany>> {
    try {
      logger.info('Creating CRM company', { name: company.name });
      return await this.provider.createCompany(company);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update company
   */
  async updateCompany(id: string, updates: Partial<CRMCompany>): Promise<CRMResult<CRMCompany>> {
    try {
      return await this.provider.updateCompany(id, updates);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create deal
   */
  async createDeal(deal: CRMDeal): Promise<CRMResult<CRMDeal>> {
    try {
      logger.info('Creating CRM deal', { name: deal.name, amount: deal.amount });
      return await this.provider.createDeal(deal);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update deal
   */
  async updateDeal(id: string, updates: Partial<CRMDeal>): Promise<CRMResult<CRMDeal>> {
    try {
      return await this.provider.updateDeal(id, updates);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Log activity
   */
  async logActivity(activity: CRMActivity): Promise<CRMResult<CRMActivity>> {
    try {
      logger.info('Logging CRM activity', {
        type: activity.type,
        contactEmail: activity.contactEmail,
      });
      return await this.provider.logActivity(activity);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get custom fields
   */
  async getCustomFields(objectType: CRMObjectType): Promise<CustomField[]> {
    return this.provider.getCustomFields(objectType);
  }

  /**
   * Create custom field
   */
  async createCustomField(field: CreateCustomFieldRequest): Promise<CustomField> {
    return this.provider.createCustomField(field);
  }

  /**
   * Handle errors
   */
  private handleError<T>(error: unknown): CRMResult<T> {
    logger.error('CRM operation error', error instanceof Error ? error : new Error(String(error)));

    return {
      success: false,
      error: {
        code: 'CRM_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
