/**
 * Mock Firestore
 * In-memory Firestore mock for testing
 */

interface MockDocument {
  id: string;
  data: any;
  exists: boolean;
}

interface MockCollection {
  [docId: string]: MockDocument;
}

export class MockFirestore {
  private collections: Map<string, MockCollection> = new Map();

  /**
   * Get or create a collection
   */
  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, {});
    }

    const self = this;
    const collectionData = this.collections.get(name)!;

    return {
      doc: (id?: string) => {
        const docId = id || self.generateId();

        return {
          id: docId,
          get: jest.fn().mockResolvedValue({
            id: docId,
            exists: !!collectionData[docId],
            data: () => collectionData[docId]?.data || null,
          }),
          set: jest.fn().mockImplementation(async (data: any) => {
            collectionData[docId] = {
              id: docId,
              data,
              exists: true,
            };
          }),
          update: jest.fn().mockImplementation(async (data: any) => {
            if (!collectionData[docId]) {
              throw new Error('Document does not exist');
            }
            collectionData[docId].data = {
              ...collectionData[docId].data,
              ...data,
            };
          }),
          delete: jest.fn().mockImplementation(async () => {
            delete collectionData[docId];
          }),
        };
      },
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        empty: Object.keys(collectionData).length === 0,
        size: Object.keys(collectionData).length,
        docs: Object.values(collectionData).map(doc => ({
          id: doc.id,
          exists: doc.exists,
          data: () => doc.data,
        })),
      }),
      add: jest.fn().mockImplementation(async (data: any) => {
        const docId = self.generateId();
        collectionData[docId] = {
          id: docId,
          data,
          exists: true,
        };
        return { id: docId };
      }),
    };
  }

  /**
   * Run a transaction
   */
  runTransaction(callback: (transaction: any) => Promise<any>) {
    const transaction = {
      get: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    return callback(transaction);
  }

  /**
   * Batch operations
   */
  batch() {
    return {
      set: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
  }

  /**
   * Generate a random ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Seed data into a collection
   */
  seed(collectionName: string, documents: Array<{ id: string; data: any }>) {
    const collection = this.collections.get(collectionName) || {};

    documents.forEach(doc => {
      collection[doc.id] = {
        id: doc.id,
        data: doc.data,
        exists: true,
      };
    });

    this.collections.set(collectionName, collection);
  }

  /**
   * Clear all data
   */
  clear() {
    this.collections.clear();
  }

  /**
   * Get all documents in a collection
   */
  getCollection(name: string): MockCollection {
    return this.collections.get(name) || {};
  }
}

/**
 * Create a mock Firestore instance
 */
export const createMockFirestore = (): MockFirestore => {
  return new MockFirestore();
};
