/**
 * PandaDoc Provider for Document Connector
 * https://developers.pandadoc.com/reference/about
 */

import axios, { AxiosInstance } from 'axios';
import { DocumentProvider } from '../document-connector';
import {
  Document,
  CreateDocumentRequest,
  SendDocumentRequest,
  DocumentTemplate,
  DownloadOptions,
  DocumentQueryOptions,
  DocumentStatus,
} from '../types';

export interface PandaDocProviderConfig {
  apiKey: string;
}

export class PandaDocProvider implements DocumentProvider {
  private client: AxiosInstance;

  constructor(config: PandaDocProviderConfig) {
    this.client = axios.create({
      baseURL: 'https://api.pandadoc.com/public/v1',
      headers: {
        'Authorization': `API-Key ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getDocument(documentId: string): Promise<Document> {
    try {
      const response = await this.client.get(`/documents/${documentId}/details`);
      return this.mapPandaDocToDocument(response.data);
    } catch (error: any) {
      throw new Error(`Failed to get document: ${error.message}`);
    }
  }

  async getDocuments(options?: DocumentQueryOptions): Promise<Document[]> {
    try {
      const params: any = {
        count: options?.limit || 100,
        page: options?.page || 1,
      };

      if (options?.status) {
        params.status = this.mapStatusToPandaDoc(options.status);
      }

      const response = await this.client.get('/documents', { params });

      return response.data.results.map((doc: any) => this.mapPandaDocToDocument(doc));
    } catch (error: any) {
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  async createDocument(request: CreateDocumentRequest): Promise<Document> {
    try {
      const payload: any = {
        name: request.name,
        recipients: request.recipients.map((r, idx) => ({
          email: r.email,
          first_name: r.firstName,
          last_name: r.lastName,
          role: r.role || 'signer',
          signing_order: idx + 1,
        })),
      };

      if (request.templateId) {
        payload.template_uuid = request.templateId;
      }

      if (request.fields) {
        payload.fields = request.fields;
      }

      if (request.message) {
        payload.message = request.message;
      }

      const response = await this.client.post('/documents', payload);

      // Wait for document to be ready
      await this.waitForDocumentReady(response.data.id);

      return this.getDocument(response.data.id);
    } catch (error: any) {
      throw new Error(`Failed to create document: ${error.message}`);
    }
  }

  async sendDocument(request: SendDocumentRequest): Promise<Document> {
    try {
      const payload: any = {
        silent: request.silent || false,
      };

      if (request.message) {
        payload.subject = 'Document for signature';
        payload.message = request.message;
      }

      await this.client.post(`/documents/${request.documentId}/send`, payload);

      return this.getDocument(request.documentId);
    } catch (error: any) {
      throw new Error(`Failed to send document: ${error.message}`);
    }
  }

  async downloadDocument(documentId: string, options?: DownloadOptions): Promise<Buffer> {
    try {
      const response = await this.client.get(`/documents/${documentId}/download`, {
        responseType: 'arraybuffer',
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      throw new Error(`Failed to download document: ${error.message}`);
    }
  }

  async voidDocument(documentId: string, reason?: string): Promise<void> {
    try {
      await this.client.post(`/documents/${documentId}/void`, {
        reason: reason || 'Voided by user',
      });
    } catch (error: any) {
      throw new Error(`Failed to void document: ${error.message}`);
    }
  }

  async getTemplates(): Promise<DocumentTemplate[]> {
    try {
      const response = await this.client.get('/templates');

      return response.data.results.map((template: any) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        createdAt: new Date(template.date_created),
      }));
    } catch (error: any) {
      throw new Error(`Failed to get templates: ${error.message}`);
    }
  }

  async getTemplate(templateId: string): Promise<DocumentTemplate> {
    try {
      const response = await this.client.get(`/templates/${templateId}/details`);

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description,
        fields: response.data.fields?.map((field: any) => ({
          name: field.name,
          type: field.type,
          required: field.required,
        })),
        createdAt: new Date(response.data.date_created),
      };
    } catch (error: any) {
      throw new Error(`Failed to get template: ${error.message}`);
    }
  }

  /**
   * Wait for document to be ready for sending
   */
  private async waitForDocumentReady(documentId: string, maxAttempts = 10): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const doc = await this.getDocument(documentId);
      if (doc.status !== 'draft' || i === maxAttempts - 1) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * Map PandaDoc document to Document
   */
  private mapPandaDocToDocument(doc: any): Document {
    return {
      id: doc.id,
      name: doc.name,
      status: this.mapPandaDocStatus(doc.status),
      dateCreated: new Date(doc.date_created),
      dateModified: new Date(doc.date_modified),
      dateCompleted: doc.date_completed ? new Date(doc.date_completed) : undefined,
      expirationDate: doc.expiration_date ? new Date(doc.expiration_date) : undefined,
      recipients: doc.recipients?.map((r: any) => ({
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        role: r.role,
        signedDate: r.date_signed ? new Date(r.date_signed) : undefined,
        status: r.has_completed ? 'completed' : 'pending',
      })),
      url: doc.session_url,
    };
  }

  /**
   * Map PandaDoc status to standard status
   */
  private mapPandaDocStatus(status: string): DocumentStatus {
    const map: Record<string, DocumentStatus> = {
      'document.draft': 'draft',
      'document.sent': 'sent',
      'document.viewed': 'viewed',
      'document.completed': 'completed',
      'document.voided': 'voided',
      'document.declined': 'declined',
      'document.expired': 'expired',
    };
    return map[status] || 'draft';
  }

  /**
   * Map standard status to PandaDoc status
   */
  private mapStatusToPandaDoc(status: DocumentStatus): string {
    const map: Record<DocumentStatus, string> = {
      'draft': 'document.draft',
      'sent': 'document.sent',
      'viewed': 'document.viewed',
      'completed': 'document.completed',
      'voided': 'document.voided',
      'declined': 'document.declined',
      'expired': 'document.expired',
    };
    return map[status] || 'document.draft';
  }
}
