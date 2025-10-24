/**
 * HubSpot CRM Provider
 * Implementation using HubSpot API
 */

import { Client } from '@hubspot/api-client';
import { CRMProvider } from '../crm-connector';
import * as Types from '../types';

export class HubSpotProvider implements CRMProvider {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client({ accessToken: apiKey });
  }

  async createContact(contact: Types.CRMContact): Promise<Types.CRMResult<Types.CRMContact>> {
    try {
      const result = await this.client.crm.contacts.basicApi.create({
        properties: {
          email: contact.email,
          firstname: contact.firstName,
          lastname: contact.lastName,
          phone: contact.phone,
          jobtitle: contact.jobTitle,
          company: contact.company,
          ...contact.customFields,
        },
      });

      return {
        success: true,
        data: { ...contact, id: result.id },
      };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async updateContact(id: string, updates: Partial<Types.CRMContact>): Promise<Types.CRMResult<Types.CRMContact>> {
    try {
      await this.client.crm.contacts.basicApi.update(id, {
        properties: {
          firstname: updates.firstName,
          lastname: updates.lastName,
          phone: updates.phone,
          jobtitle: updates.jobTitle,
          ...updates.customFields,
        },
      });

      return { success: true, data: { ...updates, id } as Types.CRMContact };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async getContact(id: string): Promise<Types.CRMResult<Types.CRMContact>> {
    try {
      const result = await this.client.crm.contacts.basicApi.getById(id);
      return {
        success: true,
        data: {
          id: result.id,
          email: result.properties.email || '',
          firstName: result.properties.firstname,
          lastName: result.properties.lastname,
          phone: result.properties.phone,
          jobTitle: result.properties.jobtitle,
          company: result.properties.company,
        },
      };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async searchContacts(query: Types.ContactSearchQuery): Promise<Types.CRMResult<Types.CRMContact[]>> {
    try {
      const filters: any[] = [];
      if (query.email) {
        filters.push({ propertyName: 'email', operator: 'EQ', value: query.email });
      }

      const result = await this.client.crm.contacts.searchApi.doSearch({
        filterGroups: filters.length > 0 ? [{ filters }] : [],
        limit: query.limit || 100,
      });

      const contacts = result.results.map((r: any) => ({
        id: r.id,
        email: r.properties.email || '',
        firstName: r.properties.firstname,
        lastName: r.properties.lastname,
        phone: r.properties.phone,
      }));

      return { success: true, data: contacts };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async createCompany(company: Types.CRMCompany): Promise<Types.CRMResult<Types.CRMCompany>> {
    try {
      const result = await this.client.crm.companies.basicApi.create({
        properties: {
          name: company.name,
          domain: company.domain,
          industry: company.industry,
          ...company.customFields,
        },
      });

      return { success: true, data: { ...company, id: result.id } };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async updateCompany(id: string, updates: Partial<Types.CRMCompany>): Promise<Types.CRMResult<Types.CRMCompany>> {
    try {
      await this.client.crm.companies.basicApi.update(id, {
        properties: { name: updates.name, domain: updates.domain, ...updates.customFields },
      });

      return { success: true, data: { ...updates, id } as Types.CRMCompany };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async createDeal(deal: Types.CRMDeal): Promise<Types.CRMResult<Types.CRMDeal>> {
    try {
      const result = await this.client.crm.deals.basicApi.create({
        properties: {
          dealname: deal.name,
          amount: deal.amount?.toString(),
          dealstage: deal.stage,
          closedate: deal.closeDate?.toISOString(),
          ...deal.customFields,
        },
      });

      return { success: true, data: { ...deal, id: result.id } };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async updateDeal(id: string, updates: Partial<Types.CRMDeal>): Promise<Types.CRMResult<Types.CRMDeal>> {
    try {
      await this.client.crm.deals.basicApi.update(id, {
        properties: {
          dealname: updates.name,
          amount: updates.amount?.toString(),
          dealstage: updates.stage,
        },
      });

      return { success: true, data: { ...updates, id } as Types.CRMDeal };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async logActivity(activity: Types.CRMActivity): Promise<Types.CRMResult<Types.CRMActivity>> {
    try {
      // HubSpot uses engagements for activities
      const result = await this.client.crm.engagements.basicApi.create({
        properties: {
          hs_engagement_type: activity.type,
          hs_engagement_subject: activity.subject,
          hs_engagement_body: activity.description,
        },
      } as any);

      return { success: true, data: { ...activity, id: result.id } };
    } catch (error: any) {
      return { success: false, error: { code: 'HUBSPOT_ERROR', message: error.message } };
    }
  }

  async getCustomFields(objectType: Types.CRMObjectType): Promise<Types.CustomField[]> {
    const objectTypeMap: Record<string, string> = {
      contact: 'contacts',
      company: 'companies',
      deal: 'deals',
      activity: 'engagements',
    };

    try {
      const result = await this.client.crm.properties.coreApi.getAll(objectTypeMap[objectType]);
      return result.results.map((p: any) => ({
        name: p.name,
        label: p.label,
        type: p.type as any,
        required: p.required || false,
      }));
    } catch {
      return [];
    }
  }

  async createCustomField(field: Types.CreateCustomFieldRequest): Promise<Types.CustomField> {
    const objectTypeMap: Record<string, string> = {
      contact: 'contacts',
      company: 'companies',
      deal: 'deals',
      activity: 'engagements',
    };

    const result = await this.client.crm.properties.coreApi.create(objectTypeMap[field.objectType], {
      name: field.name,
      label: field.label,
      type: field.type,
      groupName: 'contactinformation',
      fieldType: field.type === 'enum' ? 'select' : 'text',
      options: field.options?.map((o: string) => ({ label: o, value: o })),
    } as any);

    return {
      name: result.name,
      label: result.label,
      type: result.type as any,
      required: false,
    };
  }
}
