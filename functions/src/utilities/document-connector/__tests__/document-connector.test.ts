/**
 * Document Connector - Unit Tests
 *
 * Testing WHAT the document connector does, not HOW it works internally:
 * - Creates documents from templates or scratch
 * - Sends documents to recipients for e-signature
 * - Downloads documents in various formats
 * - Voids/cancels documents
 * - Manages document templates
 * - Queries and filters documents
 * - Provides provider abstraction for document platforms (PandaDoc, etc.)
 */

import { DocumentConnector, DocumentProvider } from '../document-connector';
import {
  Document,
  CreateDocumentRequest,
  SendDocumentRequest,
  DocumentTemplate,
  DownloadOptions,
  DocumentQueryOptions,
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

describe('Document Connector', () => {
  let mockProvider: jest.Mocked<DocumentProvider>;
  let connector: DocumentConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getDocument: jest.fn(),
      getDocuments: jest.fn(),
      createDocument: jest.fn(),
      sendDocument: jest.fn(),
      downloadDocument: jest.fn(),
      voidDocument: jest.fn(),
      getTemplates: jest.fn(),
      getTemplate: jest.fn(),
    };

    connector = new DocumentConnector(mockProvider);
  });

  describe('getDocument', () => {
    it('retrieves document by ID', async () => {
      const document: Document = {
        id: 'doc-123',
        name: 'Contract Agreement',
        status: 'draft',
        dateCreated: new Date(),
      };

      mockProvider.getDocument.mockResolvedValue(document);

      const response = await connector.getDocument('doc-123');

      expect(mockProvider.getDocument).toHaveBeenCalledWith('doc-123');
      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('doc-123');
    });

    it('handles document not found', async () => {
      mockProvider.getDocument.mockRejectedValue(new Error('Document not found'));

      const response = await connector.getDocument('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });

    it('logs document fetch', async () => {
      const document: Document = {
        id: 'doc-456',
        name: 'NDA',
        status: 'sent',
        dateCreated: new Date(),
      };

      mockProvider.getDocument.mockResolvedValue(document);

      await connector.getDocument('doc-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching document',
        expect.objectContaining({
          documentId: 'doc-456',
        })
      );
    });
  });

  describe('getDocuments', () => {
    it('retrieves all documents', async () => {
      const documents: Document[] = [
        {
          id: 'doc-1',
          name: 'Document 1',
          status: 'draft',
          dateCreated: new Date(),
        },
        {
          id: 'doc-2',
          name: 'Document 2',
          status: 'sent',
          dateCreated: new Date(),
        },
      ];

      mockProvider.getDocuments.mockResolvedValue(documents);

      const response = await connector.getDocuments();

      expect(mockProvider.getDocuments).toHaveBeenCalledWith(undefined);
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('filters documents by status', async () => {
      const options: DocumentQueryOptions = {
        status: 'completed',
      };

      const documents: Document[] = [
        {
          id: 'doc-completed',
          name: 'Completed Doc',
          status: 'completed',
          dateCreated: new Date(),
        },
      ];

      mockProvider.getDocuments.mockResolvedValue(documents);

      const response = await connector.getDocuments(options);

      expect(mockProvider.getDocuments).toHaveBeenCalledWith(options);
      expect(response.data).toHaveLength(1);
      expect(response.data?.[0].status).toBe('completed');
    });

    it('paginates documents', async () => {
      const options: DocumentQueryOptions = {
        page: 2,
        limit: 10,
      };

      const documents: Document[] = [];
      mockProvider.getDocuments.mockResolvedValue(documents);

      await connector.getDocuments(options);

      expect(mockProvider.getDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 10,
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getDocuments.mockRejectedValue(new Error('API Error'));

      const response = await connector.getDocuments();

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Failed to fetch documents');
    });
  });

  describe('createDocument', () => {
    it('creates document from template', async () => {
      const request: CreateDocumentRequest = {
        name: 'New Contract',
        templateId: 'template-123',
        recipients: [
          {
            email: 'client@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'signer',
          },
        ],
        fields: {
          company_name: 'Acme Corp',
          contract_value: '$50,000',
        },
      };

      const document: Document = {
        id: 'doc-new',
        name: 'New Contract',
        status: 'draft',
        dateCreated: new Date(),
      };

      mockProvider.createDocument.mockResolvedValue(document);

      const response = await connector.createDocument(request);

      expect(mockProvider.createDocument).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.name).toBe('New Contract');
    });

    it('creates document without template', async () => {
      const request: CreateDocumentRequest = {
        name: 'Custom Document',
        recipients: [
          {
            email: 'user@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            role: 'signer',
          },
        ],
        fields: {
          custom_field: 'Custom value',
        },
      };

      const document: Document = {
        id: 'doc-custom',
        name: 'Custom Document',
        status: 'draft',
        dateCreated: new Date(),
      };

      mockProvider.createDocument.mockResolvedValue(document);

      const response = await connector.createDocument(request);

      expect(response.success).toBe(true);
    });

    it('logs document creation', async () => {
      const request: CreateDocumentRequest = {
        name: 'Test Doc',
        templateId: 'template-456',
        recipients: [
          {
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'signer',
          },
        ],
      };

      const document: Document = {
        id: 'doc-test',
        name: 'Test Doc',
        status: 'draft',
        dateCreated: new Date(),
      };

      mockProvider.createDocument.mockResolvedValue(document);

      await connector.createDocument(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating document',
        expect.objectContaining({
          name: 'Test Doc',
          templateId: 'template-456',
          recipientCount: 1,
        })
      );
    });

    it('handles creation errors', async () => {
      const request: CreateDocumentRequest = {
        name: 'Error Doc',
        recipients: [],
      };

      mockProvider.createDocument.mockRejectedValue(new Error('Invalid request'));

      const response = await connector.createDocument(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('CREATE_ERROR');
    });
  });

  describe('sendDocument', () => {
    it('sends document to recipients', async () => {
      const request: SendDocumentRequest = {
        documentId: 'doc-123',
        message: 'Please review and sign',
      };

      const document: Document = {
        id: 'doc-123',
        name: 'Contract',
        status: 'sent',
        dateCreated: new Date(),
      };

      mockProvider.sendDocument.mockResolvedValue(document);

      const response = await connector.sendDocument(request);

      expect(mockProvider.sendDocument).toHaveBeenCalledWith(request);
      expect(response.success).toBe(true);
      expect(response.data?.status).toBe('sent');
    });

    it('sends document silently', async () => {
      const request: SendDocumentRequest = {
        documentId: 'doc-456',
        silent: true,
      };

      const document: Document = {
        id: 'doc-456',
        name: 'Silent Doc',
        status: 'sent',
        dateCreated: new Date(),
      };

      mockProvider.sendDocument.mockResolvedValue(document);

      await connector.sendDocument(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Sending document',
        expect.objectContaining({
          documentId: 'doc-456',
          silent: true,
        })
      );
    });

    it('handles send errors', async () => {
      const request: SendDocumentRequest = {
        documentId: 'doc-error',
      };

      mockProvider.sendDocument.mockRejectedValue(new Error('Send failed'));

      const response = await connector.sendDocument(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('SEND_ERROR');
    });
  });

  describe('downloadDocument', () => {
    it('downloads document as PDF', async () => {
      const buffer = Buffer.from('PDF content');
      const options: DownloadOptions = {
        format: 'pdf',
      };

      mockProvider.downloadDocument.mockResolvedValue(buffer);

      const response = await connector.downloadDocument('doc-123', options);

      expect(mockProvider.downloadDocument).toHaveBeenCalledWith('doc-123', options);
      expect(response.success).toBe(true);
      expect(Buffer.isBuffer(response.data)).toBe(true);
    });

    it('downloads document with default options', async () => {
      const buffer = Buffer.from('Document content');

      mockProvider.downloadDocument.mockResolvedValue(buffer);

      const response = await connector.downloadDocument('doc-456');

      expect(mockProvider.downloadDocument).toHaveBeenCalledWith('doc-456', undefined);
      expect(response.success).toBe(true);
    });

    it('handles download errors', async () => {
      mockProvider.downloadDocument.mockRejectedValue(new Error('Download failed'));

      const response = await connector.downloadDocument('doc-error');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DOWNLOAD_ERROR');
    });
  });

  describe('voidDocument', () => {
    it('voids document with reason', async () => {
      mockProvider.voidDocument.mockResolvedValue(undefined);

      const response = await connector.voidDocument('doc-123', 'Client requested cancellation');

      expect(mockProvider.voidDocument).toHaveBeenCalledWith(
        'doc-123',
        'Client requested cancellation'
      );
      expect(response.success).toBe(true);
    });

    it('voids document without reason', async () => {
      mockProvider.voidDocument.mockResolvedValue(undefined);

      const response = await connector.voidDocument('doc-456');

      expect(mockProvider.voidDocument).toHaveBeenCalledWith('doc-456', undefined);
      expect(response.success).toBe(true);
    });

    it('logs void operation', async () => {
      mockProvider.voidDocument.mockResolvedValue(undefined);

      await connector.voidDocument('doc-789', 'Duplicate document');

      expect(logger.info).toHaveBeenCalledWith(
        'Voiding document',
        expect.objectContaining({
          documentId: 'doc-789',
          reason: 'Duplicate document',
        })
      );
    });

    it('handles void errors', async () => {
      mockProvider.voidDocument.mockRejectedValue(new Error('Cannot void completed document'));

      const response = await connector.voidDocument('doc-completed');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('VOID_ERROR');
    });
  });

  describe('getTemplates', () => {
    it('retrieves all templates', async () => {
      const templates: DocumentTemplate[] = [
        {
          id: 'template-1',
          name: 'Standard Contract',
        },
        {
          id: 'template-2',
          name: 'NDA Template',
        },
      ];

      mockProvider.getTemplates.mockResolvedValue(templates);

      const response = await connector.getTemplates();

      expect(mockProvider.getTemplates).toHaveBeenCalled();
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });

    it('returns empty array when no templates', async () => {
      mockProvider.getTemplates.mockResolvedValue([]);

      const response = await connector.getTemplates();

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(0);
    });

    it('handles fetch errors', async () => {
      mockProvider.getTemplates.mockRejectedValue(new Error('Fetch failed'));

      const response = await connector.getTemplates();

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Failed to fetch document templates');
    });
  });

  describe('getTemplate', () => {
    it('retrieves template by ID', async () => {
      const template: DocumentTemplate = {
        id: 'template-123',
        name: 'Employment Contract',
      };

      mockProvider.getTemplate.mockResolvedValue(template);

      const response = await connector.getTemplate('template-123');

      expect(mockProvider.getTemplate).toHaveBeenCalledWith('template-123');
      expect(response.success).toBe(true);
      expect(response.data?.name).toBe('Employment Contract');
    });

    it('handles template not found', async () => {
      mockProvider.getTemplate.mockRejectedValue(new Error('Template not found'));

      const response = await connector.getTemplate('nonexistent');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('FETCH_ERROR');
    });
  });

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockProvider.getDocument.mockRejectedValue('String error');

      const response = await connector.getDocument('doc-123');

      expect(response.success).toBe(false);
    });

    it('logs all errors', async () => {
      mockProvider.createDocument.mockRejectedValue(new Error('Test error'));

      const request: CreateDocumentRequest = {
        name: 'Test',
        recipients: [],
      };

      await connector.createDocument(request);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
