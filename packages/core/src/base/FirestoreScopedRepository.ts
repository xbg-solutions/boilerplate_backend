/**
 * Firestore implementation of IScopedRepository and ITransactionManager.
 *
 * These classes are the Firestore-specific counterparts to the database-agnostic
 * interfaces in types/repository.ts. Service code should depend on the interfaces,
 * not on these classes directly.
 */

import {
  Firestore,
  CollectionReference,
  DocumentData,
  Query,
  Transaction,
  DocumentReference,
} from 'firebase-admin/firestore';
import { logger } from '@xbg.solutions/utils-logger';
import { RepositoryError } from '../types/errors';
import {
  TransactionContext,
  ITransactionManager,
  IScopedRepository,
  QueryOptions,
  WhereFilterOp,
} from '../types/repository';

// ---------------------------------------------------------------------------
// Firestore Transaction Context
// ---------------------------------------------------------------------------

/**
 * Firestore-specific transaction context. Only Firestore repository
 * implementations should downcast to this type — service code must
 * treat TransactionContext as opaque.
 */
export class FirestoreTransactionContext extends TransactionContext {
  readonly provider = 'firestore' as const;
  constructor(public readonly transaction: Transaction) {
    super();
  }
}

// ---------------------------------------------------------------------------
// Firestore Transaction Manager
// ---------------------------------------------------------------------------

export class FirestoreTransactionManager implements ITransactionManager {
  constructor(private db: Firestore) {}

  async run<R>(description: string, callback: (tx: TransactionContext) => Promise<R>): Promise<R> {
    logger.info('Transaction started', { description });

    try {
      const result = await this.db.runTransaction(async (firestoreTx) => {
        const ctx = new FirestoreTransactionContext(firestoreTx);
        return callback(ctx);
      });

      logger.info('Transaction committed', { description });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Transaction failed', err, { description });
      throw new RepositoryError(`Transaction "${description}" failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the raw Firestore Transaction from a TransactionContext.
 * Throws if the context is not a FirestoreTransactionContext.
 */
function unwrapTx(tx: TransactionContext): Transaction {
  if (!(tx instanceof FirestoreTransactionContext)) {
    throw new RepositoryError(
      'Expected a FirestoreTransactionContext but received a different provider'
    );
  }
  return tx.transaction;
}

/**
 * Map our abstract WhereFilterOp to the Firestore operator type.
 * Since our union is a strict subset of Firestore's, this is a passthrough
 * but keeps the type boundary explicit.
 */
function toFirestoreOp(op: WhereFilterOp): FirebaseFirestore.WhereFilterOp {
  return op as FirebaseFirestore.WhereFilterOp;
}

/**
 * Build a Firestore CollectionReference from an alternating array of
 * [collection, docId, collection, docId, ..., collection].
 *
 * The array must have an odd number of elements — the last element is
 * always a collection name.
 */
function buildCollectionRef(
  db: Firestore,
  pathSegments: readonly string[]
): CollectionReference<DocumentData> {
  if (pathSegments.length === 0 || pathSegments.length % 2 === 0) {
    throw new RepositoryError(
      `Path segments must be odd-length [col, docId, ..., col]. Got: [${pathSegments.join(', ')}]`
    );
  }

  let ref: CollectionReference<DocumentData> = db.collection(pathSegments[0]);

  for (let i = 1; i < pathSegments.length; i += 2) {
    const docId = pathSegments[i];
    const colName = pathSegments[i + 1];
    ref = ref.doc(docId).collection(colName);
  }

  return ref;
}

// ---------------------------------------------------------------------------
// Firestore Scoped Repository
// ---------------------------------------------------------------------------

export class FirestoreScopedRepository<T> implements IScopedRepository<T> {
  private collectionRef: CollectionReference<DocumentData>;

  constructor(
    private db: Firestore,
    pathSegments: readonly string[],
    private entityFactory: (id: string, data: Record<string, any>) => T
  ) {
    this.collectionRef = buildCollectionRef(db, pathSegments);
  }

  private docRef(id: string): DocumentReference<DocumentData> {
    return this.collectionRef.doc(id);
  }

  async findById(id: string, tx?: TransactionContext): Promise<T | null> {
    try {
      const ref = this.docRef(id);
      const snap = tx
        ? await unwrapTx(tx).get(ref)
        : await ref.get();

      if (!snap.exists) return null;

      const data = snap.data();
      if (!data || data.deletedAt) return null;

      return this.entityFactory(snap.id, data);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      throw new RepositoryError(`ScopedRepository.findById failed: ${err.message}`);
    }
  }

  async findAll(options: QueryOptions = {}, tx?: TransactionContext): Promise<T[]> {
    try {
      let query: Query = this.collectionRef;

      if (!options.includeSoftDeleted) {
        query = query.where('deletedAt', '==', null);
      }

      if (options.where) {
        for (const clause of options.where) {
          query = query.where(clause.field, toFirestoreOp(clause.operator), clause.value);
        }
      }

      if (options.orderBy) {
        for (const order of options.orderBy) {
          query = query.orderBy(order.field, order.direction);
        }
      }

      if (options.offset) {
        query = query.offset(options.offset);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const snapshot = tx
        ? await unwrapTx(tx).get(query)
        : await query.get();

      return snapshot.docs.map((doc) => this.entityFactory(doc.id, doc.data()));
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      throw new RepositoryError(`ScopedRepository.findAll failed: ${err.message}`);
    }
  }

  async findOneWhere(conditions: Record<string, any>, tx?: TransactionContext): Promise<T | null> {
    const whereClauses = Object.entries(conditions).map(([field, value]) => ({
      field,
      operator: '==' as WhereFilterOp,
      value,
    }));

    const results = await this.findAll(
      { where: whereClauses, limit: 1 },
      tx
    );

    return results.length > 0 ? results[0] : null;
  }

  async create(data: Partial<T>, tx?: TransactionContext): Promise<T> {
    try {
      const ref = this.collectionRef.doc();
      const now = new Date().toISOString();
      const docData = {
        ...data,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1,
      } as Record<string, any>;

      if (tx) {
        unwrapTx(tx).set(ref, docData);
      } else {
        await ref.set(docData);
      }

      return this.entityFactory(ref.id, docData);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      throw new RepositoryError(`ScopedRepository.create failed: ${err.message}`);
    }
  }

  async updateFields(id: string, fields: Record<string, any>, tx?: TransactionContext): Promise<void> {
    try {
      const ref = this.docRef(id);
      const updateData = {
        ...fields,
        updatedAt: new Date().toISOString(),
      };

      if (tx) {
        unwrapTx(tx).update(ref, updateData);
      } else {
        await ref.update(updateData);
      }
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      throw new RepositoryError(`ScopedRepository.updateFields failed: ${err.message}`);
    }
  }

  async remove(id: string, tx?: TransactionContext): Promise<void> {
    try {
      const ref = this.docRef(id);
      const softDelete = {
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (tx) {
        unwrapTx(tx).update(ref, softDelete);
      } else {
        await ref.update(softDelete);
      }
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      throw new RepositoryError(`ScopedRepository.remove failed: ${err.message}`);
    }
  }
}
