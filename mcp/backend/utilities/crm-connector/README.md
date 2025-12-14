# CRM Connector

> Sync customer data with CRM platforms (HubSpot, Salesforce, Attio)

## Overview

The CRM Connector provides a unified interface for syncing contacts, companies, deals, and activities with popular CRM platforms. It enables seamless customer data synchronization, activity tracking, and sales pipeline management.

## Features

- **Contact management** (create, read, update, delete, search)
- **Company management** for B2B scenarios
- **Deal tracking** and pipeline management
- **Activity logging** for customer interactions
- **Custom fields** support
- **Tag management** for contact segmentation
- **Search and filtering** capabilities
- **Multiple providers** (HubSpot, Salesforce, Attio)
- **Provider abstraction** for easy switching
- **Error handling** with detailed responses

## Installation

```typescript
import {
  createCRMConnector,
  getCRMConnector,
  CRMConnector,
} from '../utilities/crm-connector';
```

## Configuration

```typescript
export const COMMUNICATIONS_CONFIG = {
  crm: {
    enabled: true,
    provider: 'hubspot', // 'salesforce' | 'attio'
    providers: {
      hubspot: {
        apiKey: process.env.HUBSPOT_API_KEY || '',
      },
      salesforce: {
        // Not yet implemented
      },
      attio: {
        // Not yet implemented
      },
    },
  },
};
```

## Usage

### Create Contact

```typescript
const crmConnector = getCRMConnector();

const result = await crmConnector.createContact({
  email: 'customer@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+61412345678',
  company: 'Acme Corp',
  jobTitle: 'CEO',
  tags: ['customer', 'vip'],
  customFields: {
    industry: 'Technology',
    companySize: '50-100',
  },
});

if (result.success) {
  console.log('Contact created:', result.data?.id);
}
```

### Update Contact

```typescript
await crmConnector.updateContact('contact-id', {
  jobTitle: 'CTO',
  tags: ['customer', 'vip', 'technical'],
});
```

### Create Deal

```typescript
await crmConnector.createDeal({
  name: 'Enterprise Contract',
  amount: 50000,
  stage: 'proposal',
  contactId: 'contact-id',
  companyId: 'company-id',
  closeDate: new Date('2024-12-31'),
  probability: 0.75,
});
```

### Log Activity

```typescript
await crmConnector.logActivity({
  contactEmail: 'customer@example.com',
  type: 'email',
  subject: 'Follow-up call scheduled',
  description: 'Scheduled demo for next Tuesday',
  timestamp: new Date(),
});
```

### Search Contacts

```typescript
const contacts = await crmConnector.searchContacts({
  company: 'Acme Corp',
  tags: ['customer'],
  limit: 50,
});
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **Salesforce** provider implementation
- [ ] **Attio** provider implementation
- [ ] **Pipedrive** provider
- [ ] **Zoho CRM** provider
- [ ] **Microsoft Dynamics** provider

### Missing Features
- [ ] **Bulk operations** for contacts/companies/deals
- [ ] **Webhooks** for CRM event notifications
- [ ] **Email tracking** integration
- [ ] **Meeting scheduling** integration
- [ ] **Document attachment** to records
- [ ] **Task management** integration
- [ ] **Notes** and timeline management
- [ ] **Lead scoring** automation
- [ ] **Data deduplication** logic
- [ ] **Field mapping** configuration
- [ ] **Sync conflict** resolution
- [ ] **Two-way sync** capabilities
- [ ] **Historical data** migration tools

## Related Components

- **communications.config.ts**: CRM configuration
- **events**: Event-driven CRM sync
- **logger**: Structured logging

## References

- [HubSpot API](https://developers.hubspot.com/)
- [Salesforce API](https://developer.salesforce.com/)
- [Attio API](https://developers.attio.com/)
