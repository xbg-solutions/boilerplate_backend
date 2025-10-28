/**
 * CRM Connector - Unit Tests
 *
 * Testing WHAT the CRM connector does, not HOW it works internally:
 * - Creates and updates contacts, companies, and deals
 * - Searches for contacts
 * - Logs activities
 * - Manages custom fields
 * - Handles errors gracefully
 * - Provides provider abstraction for CRM systems (HubSpot, etc.)
 */

import { CRMConnector, CRMProvider } from '../crm-connector';
import {
  CRMContact,
  CRMCompany,
  CRMDeal,
  CRMActivity,
  CRMResult,
  ContactSearchQuery,
  CustomField,
  CreateCustomFieldRequest,
} from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CRM Connector', () => {
  let mockProvider: jest.Mocked<CRMProvider>;
  let connector: CRMConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      createContact: jest.fn(),
      updateContact: jest.fn(),
      getContact: jest.fn(),
      searchContacts: jest.fn(),
      createCompany: jest.fn(),
      updateCompany: jest.fn(),
      createDeal: jest.fn(),
      updateDeal: jest.fn(),
      logActivity: jest.fn(),
      getCustomFields: jest.fn(),
      createCustomField: jest.fn(),
    };

    connector = new CRMConnector(mockProvider);
  });

  describe('createContact', () => {
    it('creates contact successfully', async () => {
      const contact: CRMContact = {
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        company: 'Acme Corp',
        source: 'website',
      };

      const result: CRMResult<CRMContact> = {
        success: true,
        data: { ...contact, id: 'contact-123' },
      };

      mockProvider.createContact.mockResolvedValue(result);

      const response = await connector.createContact(contact);

      expect(mockProvider.createContact).toHaveBeenCalledWith(contact);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('contact-123');
    });

    it('logs contact creation', async () => {
      const contact: CRMContact = {
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      };

      const result: CRMResult<CRMContact> = {
        success: true,
        data: { ...contact, id: 'contact-456' },
      };

      mockProvider.createContact.mockResolvedValue(result);

      await connector.createContact(contact);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating CRM contact',
        expect.objectContaining({
          email: 'jane@example.com',
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Contact created successfully',
        expect.objectContaining({
          id: 'contact-456',
        })
      );
    });

    it('handles contact creation failure', async () => {
      const contact: CRMContact = {
        email: 'invalid@example.com',
        firstName: 'Test',
      };

      const result: CRMResult<CRMContact> = {
        success: false,
        error: {
          code: 'DUPLICATE_EMAIL',
          message: 'Contact with this email already exists',
        },
      };

      mockProvider.createContact.mockResolvedValue(result);

      const response = await connector.createContact(contact);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DUPLICATE_EMAIL');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('handles provider errors', async () => {
      const contact: CRMContact = {
        email: 'test@example.com',
        firstName: 'Test',
      };

      mockProvider.createContact.mockRejectedValue(new Error('Network error'));

      const response = await connector.createContact(contact);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Network error');
    });
  });

  describe('updateContact', () => {
    it('updates contact successfully', async () => {
      const updates: Partial<CRMContact> = {
        phone: '+9876543210',
        company: 'New Corp',
      };

      const result: CRMResult<CRMContact> = {
        success: true,
        data: {
          id: 'contact-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
          ...updates,
        },
      };

      mockProvider.updateContact.mockResolvedValue(result);

      const response = await connector.updateContact('contact-123', updates);

      expect(mockProvider.updateContact).toHaveBeenCalledWith('contact-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.phone).toBe('+9876543210');
    });

    it('logs contact update', async () => {
      const updates: Partial<CRMContact> = {
        lastName: 'UpdatedName',
      };

      const result: CRMResult<CRMContact> = {
        success: true,
        data: { id: 'contact-789', email: 'test@example.com', ...updates },
      };

      mockProvider.updateContact.mockResolvedValue(result);

      await connector.updateContact('contact-789', updates);

      expect(logger.info).toHaveBeenCalledWith(
        'Updating CRM contact',
        expect.objectContaining({
          id: 'contact-789',
        })
      );
    });

    it('handles update errors', async () => {
      mockProvider.updateContact.mockRejectedValue(new Error('Update failed'));

      const response = await connector.updateContact('contact-123', {});

      expect(response.success).toBe(false);
    });
  });

  describe('getContact', () => {
    it('retrieves contact by ID', async () => {
      const result: CRMResult<CRMContact> = {
        success: true,
        data: {
          id: 'contact-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      };

      mockProvider.getContact.mockResolvedValue(result);

      const response = await connector.getContact('contact-123');

      expect(mockProvider.getContact).toHaveBeenCalledWith('contact-123');
      expect(response.success).toBe(true);
      expect(response.data?.email).toBe('john@example.com');
    });

    it('handles contact not found', async () => {
      const result: CRMResult<CRMContact> = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Contact not found',
        },
      };

      mockProvider.getContact.mockResolvedValue(result);

      const response = await connector.getContact('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('searchContacts', () => {
    it('searches contacts by email', async () => {
      const query: ContactSearchQuery = {
        email: 'john@example.com',
      };

      const result: CRMResult<CRMContact[]> = {
        success: true,
        data: [
          {
            id: 'contact-123',
            email: 'john@example.com',
            firstName: 'John',
            lastName: 'Doe',
          },
        ],
      };

      mockProvider.searchContacts.mockResolvedValue(result);

      const response = await connector.searchContacts(query);

      expect(mockProvider.searchContacts).toHaveBeenCalledWith(query);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
    });

    it('searches contacts by company', async () => {
      const query: ContactSearchQuery = {
        company: 'Acme Corp',
      };

      const result: CRMResult<CRMContact[]> = {
        success: true,
        data: [
          {
            id: 'contact-1',
            email: 'person1@acme.com',
            firstName: 'Person',
            lastName: 'One',
            company: 'Acme Corp',
          },
          {
            id: 'contact-2',
            email: 'person2@acme.com',
            firstName: 'Person',
            lastName: 'Two',
            company: 'Acme Corp',
          },
        ],
      };

      mockProvider.searchContacts.mockResolvedValue(result);

      const response = await connector.searchContacts(query);

      expect(response.data).toHaveLength(2);
    });

    it('returns empty array when no matches', async () => {
      const query: ContactSearchQuery = {
        email: 'nonexistent@example.com',
      };

      const result: CRMResult<CRMContact[]> = {
        success: true,
        data: [],
      };

      mockProvider.searchContacts.mockResolvedValue(result);

      const response = await connector.searchContacts(query);

      expect(response.data).toHaveLength(0);
    });
  });

  describe('createCompany', () => {
    it('creates company successfully', async () => {
      const company: CRMCompany = {
        name: 'Tech Startup Inc',
        domain: 'techstartup.com',
        industry: 'Technology',
      };

      const result: CRMResult<CRMCompany> = {
        success: true,
        data: { ...company, id: 'company-123' },
      };

      mockProvider.createCompany.mockResolvedValue(result);

      const response = await connector.createCompany(company);

      expect(mockProvider.createCompany).toHaveBeenCalledWith(company);
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('company-123');
    });

    it('logs company creation', async () => {
      const company: CRMCompany = {
        name: 'New Business LLC',
        domain: 'newbiz.com',
      };

      const result: CRMResult<CRMCompany> = {
        success: true,
        data: { ...company, id: 'company-456' },
      };

      mockProvider.createCompany.mockResolvedValue(result);

      await connector.createCompany(company);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating CRM company',
        expect.objectContaining({
          name: 'New Business LLC',
        })
      );
    });
  });

  describe('updateCompany', () => {
    it('updates company successfully', async () => {
      const updates: Partial<CRMCompany> = {
        industry: 'SaaS',
      };

      const result: CRMResult<CRMCompany> = {
        success: true,
        data: {
          id: 'company-123',
          name: 'Tech Startup Inc',
          domain: 'techstartup.com',
          ...updates,
        },
      };

      mockProvider.updateCompany.mockResolvedValue(result);

      const response = await connector.updateCompany('company-123', updates);

      expect(mockProvider.updateCompany).toHaveBeenCalledWith('company-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.industry).toBe('SaaS');
    });
  });

  describe('createDeal', () => {
    it('creates deal successfully', async () => {
      const deal: CRMDeal = {
        name: 'Enterprise Deal',
        amount: 50000,
        stage: 'proposal',
        contactId: 'contact-123',
        closeDate: new Date('2024-12-31'),
      };

      const result: CRMResult<CRMDeal> = {
        success: true,
        data: { ...deal, id: 'deal-123' },
      };

      mockProvider.createDeal.mockResolvedValue(result);

      const response = await connector.createDeal(deal);

      expect(mockProvider.createDeal).toHaveBeenCalledWith(deal);
      expect(response.success).toBe(true);
      expect(response.data?.amount).toBe(50000);
    });

    it('logs deal creation with amount', async () => {
      const deal: CRMDeal = {
        name: 'Small Deal',
        amount: 5000,
        stage: 'qualification',
      };

      const result: CRMResult<CRMDeal> = {
        success: true,
        data: { ...deal, id: 'deal-456' },
      };

      mockProvider.createDeal.mockResolvedValue(result);

      await connector.createDeal(deal);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating CRM deal',
        expect.objectContaining({
          name: 'Small Deal',
          amount: 5000,
        })
      );
    });
  });

  describe('updateDeal', () => {
    it('updates deal successfully', async () => {
      const updates: Partial<CRMDeal> = {
        stage: 'closed-won',
        amount: 60000,
      };

      const result: CRMResult<CRMDeal> = {
        success: true,
        data: {
          id: 'deal-123',
          name: 'Enterprise Deal',
          ...updates,
        },
      };

      mockProvider.updateDeal.mockResolvedValue(result);

      const response = await connector.updateDeal('deal-123', updates);

      expect(mockProvider.updateDeal).toHaveBeenCalledWith('deal-123', updates);
      expect(response.success).toBe(true);
      expect(response.data?.stage).toBe('closed-won');
    });
  });

  describe('logActivity', () => {
    it('logs activity successfully', async () => {
      const activity: CRMActivity = {
        type: 'email',
        subject: 'Follow-up email',
        description: 'Sent follow-up regarding proposal',
        contactId: 'contact-123',
        timestamp: new Date(),
      };

      const result: CRMResult<CRMActivity> = {
        success: true,
        data: { ...activity, id: 'activity-123' },
      };

      mockProvider.logActivity.mockResolvedValue(result);

      const response = await connector.logActivity(activity);

      expect(mockProvider.logActivity).toHaveBeenCalledWith(activity);
      expect(response.success).toBe(true);
      expect(response.data?.type).toBe('email');
    });

    it('logs different activity types', async () => {
      const callActivity: CRMActivity = {
        type: 'call',
        subject: 'Discovery call',
        contactId: 'contact-123',
        timestamp: new Date(),
      };

      const result: CRMResult<CRMActivity> = {
        success: true,
        data: { ...callActivity, id: 'activity-456' },
      };

      mockProvider.logActivity.mockResolvedValue(result);

      const response = await connector.logActivity(callActivity);

      expect(response.success).toBe(true);
      expect(response.data?.type).toBe('call');
    });
  });

  describe('getCustomFields', () => {
    it('retrieves custom fields for contact type', async () => {
      const fields: CustomField[] = [
        {
          name: 'lead_source',
          label: 'Lead Source',
          type: 'enum',
        },
        {
          name: 'customer_tier',
          label: 'Customer Tier',
          type: 'enum',
        },
      ];

      mockProvider.getCustomFields.mockResolvedValue(fields);

      const result = await connector.getCustomFields('contact');

      expect(mockProvider.getCustomFields).toHaveBeenCalledWith('contact');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('lead_source');
    });

    it('retrieves custom fields for company type', async () => {
      const fields: CustomField[] = [
        {
          name: 'annual_revenue',
          label: 'Annual Revenue',
          type: 'number',
        },
      ];

      mockProvider.getCustomFields.mockResolvedValue(fields);

      const result = await connector.getCustomFields('company');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('number');
    });
  });

  describe('createCustomField', () => {
    it('creates custom field successfully', async () => {
      const fieldRequest: CreateCustomFieldRequest = {
        name: 'industry_vertical',
        label: 'Industry Vertical',
        type: 'enum',
        objectType: 'company',
        options: ['FinTech', 'HealthTech', 'EdTech'],
      };

      const field: CustomField = {
        name: fieldRequest.name,
        label: fieldRequest.label,
        type: fieldRequest.type,
        options: fieldRequest.options,
      };

      mockProvider.createCustomField.mockResolvedValue(field);

      const result = await connector.createCustomField(fieldRequest);

      expect(mockProvider.createCustomField).toHaveBeenCalledWith(fieldRequest);
      expect(result.name).toBe('industry_vertical');
      expect(result.options).toHaveLength(3);
    });

    it('creates string field', async () => {
      const fieldRequest: CreateCustomFieldRequest = {
        name: 'internal_notes',
        label: 'Internal Notes',
        type: 'string',
        objectType: 'contact',
      };

      const field: CustomField = {
        name: fieldRequest.name,
        label: fieldRequest.label,
        type: fieldRequest.type,
      };

      mockProvider.createCustomField.mockResolvedValue(field);

      const result = await connector.createCustomField(fieldRequest);

      expect(result.type).toBe('string');
    });
  });

  describe('error handling', () => {
    it('handles provider errors gracefully', async () => {
      mockProvider.createContact.mockRejectedValue(new Error('API Error'));

      const contact: CRMContact = {
        email: 'test@example.com',
        firstName: 'Test',
      };

      const response = await connector.createContact(contact);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('handles network timeouts', async () => {
      mockProvider.getContact.mockRejectedValue(new Error('Request timeout'));

      const response = await connector.getContact('contact-123');

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('timeout');
    });
  });
});
