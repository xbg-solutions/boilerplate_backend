/**
 * Document Connector
 * Document creation, management, and e-signature
 */

import {
  Document,
  CreateDocumentRequest,
  SendDocumentRequest,
  DocumentTemplate,
  DownloadOptions,
  DocumentQueryOptions,
  DocumentResponse,
} from './types';
import { logger } from '../logger';

/**
 * Document Provider Interface
 */
export interface DocumentProvider {
  /**
   * Get document by ID
   */
  getDocument(documentId: string): Promise<Document>;

  /**
   * Get documents with filtering
   */
  getDocuments(options?: DocumentQueryOptions): Promise<Document[]>;

  /**
   * Create document from template or scratch
   */
  createDocument(request: CreateDocumentRequest): Promise<Document>;

  /**
   * Send document to recipients
   */
  sendDocument(request: SendDocumentRequest): Promise<Document>;

  /**
   * Download document
   */
  downloadDocument(documentId: string, options?: DownloadOptions): Promise<Buffer>;

  /**
   * Void/cancel document
   */
  voidDocument(documentId: string, reason?: string): Promise<void>;

  /**
   * Get templates
   */
  getTemplates(): Promise<DocumentTemplate[]>;

  /**
   * Get template by ID
   */
  getTemplate(templateId: string): Promise<DocumentTemplate>;
}

/**
 * Document Connector
 * Unified interface for document management platforms
 */
export class DocumentConnector {
  private provider: DocumentProvider;

  constructor(provider: DocumentProvider) {
    this.provider = provider;
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<DocumentResponse<Document>> {
    logger.info('Fetching document', { documentId });

    try {
      const document = await this.provider.getDocument(documentId);
      return { success: true, data: document };
    } catch (error) {
      logger.error('Error fetching document', {
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get documents
   */
  async getDocuments(options?: DocumentQueryOptions): Promise<DocumentResponse<Document[]>> {
    logger.info('Fetching documents', { options });

    try {
      const documents = await this.provider.getDocuments(options);
      return { success: true, data: documents };
    } catch (error) {
      logger.error('Error fetching documents', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Create document
   */
  async createDocument(request: CreateDocumentRequest): Promise<DocumentResponse<Document>> {
    logger.info('Creating document', {
      name: request.name,
      templateId: request.templateId,
      recipientCount: request.recipients.length,
    });

    try {
      const document = await this.provider.createDocument(request);
      return { success: true, data: document };
    } catch (error) {
      logger.error('Error creating document', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CREATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Send document to recipients
   */
  async sendDocument(request: SendDocumentRequest): Promise<DocumentResponse<Document>> {
    logger.info('Sending document', {
      documentId: request.documentId,
      silent: request.silent,
    });

    try {
      const document = await this.provider.sendDocument(request);
      return { success: true, data: document };
    } catch (error) {
      logger.error('Error sending document', {
        documentId: request.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'SEND_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Download document
   */
  async downloadDocument(documentId: string, options?: DownloadOptions): Promise<DocumentResponse<Buffer>> {
    logger.info('Downloading document', { documentId, options });

    try {
      const buffer = await this.provider.downloadDocument(documentId, options);
      return { success: true, data: buffer };
    } catch (error) {
      logger.error('Error downloading document', {
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'DOWNLOAD_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Void document
   */
  async voidDocument(documentId: string, reason?: string): Promise<DocumentResponse<void>> {
    logger.info('Voiding document', { documentId, reason });

    try {
      await this.provider.voidDocument(documentId, reason);
      return { success: true };
    } catch (error) {
      logger.error('Error voiding document', {
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'VOID_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get templates
   */
  async getTemplates(): Promise<DocumentResponse<DocumentTemplate[]>> {
    logger.info('Fetching document templates');

    try {
      const templates = await this.provider.getTemplates();
      return { success: true, data: templates };
    } catch (error) {
      logger.error('Error fetching templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get template by ID
   */
  async getTemplate(templateId: string): Promise<DocumentResponse<DocumentTemplate>> {
    logger.info('Fetching template', { templateId });

    try {
      const template = await this.provider.getTemplate(templateId);
      return { success: true, data: template };
    } catch (error) {
      logger.error('Error fetching template', {
        templateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
