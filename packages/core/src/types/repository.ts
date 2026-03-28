/**
 * Database-agnostic repository types
 *
 * These interfaces define the contract for repository operations without
 * coupling to any specific database technology. Services should depend on
 * these interfaces, never on Firestore/MongoDB/SQL types directly.
 */

/**
 * Database-agnostic where filter operators.
 * Covers the common subset supported by Firestore, MongoDB, and SQL.
 */
export type WhereFilterOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any';

/**
 * A single where clause for filtering queries.
 */
export interface WhereClause {
  field: string;
  operator: WhereFilterOp;
  value: any;
}

/**
 * Options for querying collections.
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  where?: WhereClause[];
  includeSoftDeleted?: boolean;
}

/**
 * Paginated result set.
 */
export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Opaque transaction context passed through service and repository layers.
 *
 * Service code should treat this as an opaque token — pass it through
 * but never access its internals. Only database-specific implementations
 * should downcast via the concrete subclass (e.g. FirestoreTransactionContext).
 */
export abstract class TransactionContext {
  abstract readonly provider: string;
}

/**
 * Database-agnostic transaction manager.
 *
 * Wraps the underlying database's transaction mechanism so that service
 * code can perform atomic multi-document operations without importing
 * database-specific modules.
 */
export interface ITransactionManager {
  /**
   * Execute a callback within a database transaction.
   * @param description Human-readable label for logging/debugging
   * @param callback The work to perform inside the transaction
   */
  run<R>(description: string, callback: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

/**
 * Database-agnostic interface for CRUD operations scoped to a parent context.
 *
 * Used for subcollection access (Firestore), filtered queries (MongoDB),
 * or foreign-key-scoped queries (SQL). Services interact with this interface
 * and never see the underlying database technology.
 */
export interface IScopedRepository<T> {
  findById(id: string, tx?: TransactionContext): Promise<T | null>;

  findAll(options?: QueryOptions, tx?: TransactionContext): Promise<T[]>;

  findOneWhere(conditions: Record<string, any>, tx?: TransactionContext): Promise<T | null>;

  create(data: Partial<T>, tx?: TransactionContext): Promise<T>;

  updateFields(id: string, fields: Record<string, any>, tx?: TransactionContext): Promise<void>;

  remove(id: string, tx?: TransactionContext): Promise<void>;
}

/**
 * Storage configuration for an entity — describes where and how the entity
 * is persisted. Used by the generator to emit the correct repository code.
 */
export interface EntityStorageConfig {
  type: 'collection' | 'subcollection';
  parent?: {
    entity: string;
    collectionName: string;
  };
}
