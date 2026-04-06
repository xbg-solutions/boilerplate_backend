/**
 * Embedded Handlebars Templates
 * All code generation templates as string constants
 * This ensures templates are bundled with the compiled code
 */

/**
 * Entity Template
 * Generates entity class with data interface
 */
export const ENTITY_TEMPLATE = `/**
 * {{entityName}} Entity
 * Generated from data model specification
 */

{{#each imports}}
{{{this}}}
{{/each}}

export interface {{entityName}}Data extends BaseEntityData {
{{#each fields}}
{{#unless isBaseEntityField}}
  {{name}}{{#unless required}}?{{/unless}}: {{{tsType}}};
{{/unless}}
{{/each}}
}

export class {{entityName}} extends BaseEntity {
{{#each fields}}
{{#unless isBaseEntityField}}
  {{name}}{{#unless required}}?{{/unless}}: {{{tsType}}};
{{/unless}}
{{/each}}

  constructor(data: {{entityName}}Data) {
    super(data);
{{#each fields}}
{{#unless isBaseEntityField}}
    this.{{name}} = data.{{name}}{{#if hasDefault}} || {{{defaultValue}}}{{/if}};
{{/unless}}
{{/each}}
  }

  /**
   * Get entity-specific data for Firestore
   */
  protected getEntityData(): Record<string, any> {
{{#if hasEncryption}}
    return hashTransparentFields({
{{#each fields}}
{{#unless isBaseEntityField}}
      {{name}}: this.{{name}},
{{/unless}}
{{/each}}
    }, '{{entityNameLower}}');
{{else}}
    return {
{{#each fields}}
{{#unless isBaseEntityField}}
      {{name}}: this.{{name}},
{{/unless}}
{{/each}}
    };
{{/if}}
  }

  /**
   * Validate entity
   */
  validate(): ValidationResult {
    const errors = ValidationHelper.collectErrors(
{{#each fields}}
  {{#each validation}}
      {{{this}}},
  {{/each}}
{{/each}}
    );

    return ValidationHelper.isValidResult(errors);
  }

  /**
   * Create entity from Firestore document
   */
  static override fromFirestore(id: string, data: Record<string, any>): {{entityName}} {
{{#if hasEncryption}}
    const decrypted = unhashTransparentFields(data, '{{entityNameLower}}');
    return new {{entityName}}({
      id,
      ...decrypted,
    });
{{else}}
    return new {{entityName}}({
      id,
      ...data,
    });
{{/if}}
  }

  /**
   * Convert to plain object for API responses
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
{{#each fields}}
{{#unless isBaseEntityField}}
      {{name}}: this.{{name}},
{{/unless}}
{{/each}}
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      {{#if hasSoftDelete}}
      deletedAt: this.deletedAt,
      {{/if}}
    };
  }
}
`;

/**
 * Repository Template
 * Generates repository class for entity
 */
export const REPOSITORY_TEMPLATE = `/**
 * {{entityName}} Repository
 * Generated from data model specification
 */

{{#if isSubcollection}}
import { RepositoryFactory, IScopedRepository, QueryOptions } from '@xbg.solutions/backend-core';
import { {{entityName}} } from '../entities/{{entityName}}';

/**
 * Scoped repository for {{entityName}} subcollection.
 * Path pattern: {{subcollectionName}}/{parentId}/{{collectionName}}
 */
export class {{entityName}}Repository {
  private repo: IScopedRepository<{{entityName}}>;

  constructor(factory: RepositoryFactory, parentPath: string[]) {
    this.repo = factory.createScopedRepository(
      'default',
      parentPath,
      (id, data) => {{entityName}}.fromFirestore(id, data)
    );
  }

  async findById(id: string): Promise<{{entityName}} | null> {
    return this.repo.findById(id);
  }

  async findAll(options?: QueryOptions): Promise<{{entityName}}[]> {
    return this.repo.findAll(options);
  }

  async findOneWhere(conditions: Record<string, any>): Promise<{{entityName}} | null> {
    return this.repo.findOneWhere(conditions);
  }

  async create(data: Partial<{{entityName}}>): Promise<{{entityName}}> {
    return this.repo.create(data);
  }

  async updateFields(id: string, fields: Record<string, any>): Promise<void> {
    return this.repo.updateFields(id, fields);
  }

  async remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
{{else}}
import { Firestore, DocumentData } from 'firebase-admin/firestore';
import { BaseRepository } from '@xbg.solutions/backend-core';
import { {{entityName}} } from '../entities/{{entityName}}';

export class {{entityName}}Repository extends BaseRepository<{{entityName}}> {
  protected collectionName = '{{collectionName}}';

  constructor(db: Firestore) {
    super(db);
  }

  /**
   * Convert Firestore document to entity
   */
  protected fromFirestore(id: string, data: DocumentData): {{entityName}} {
    return {{entityName}}.fromFirestore(id, data);
  }

{{#each fields}}
{{#if unique}}
  /**
   * Find {{../entityName}} by {{name}}
   */
  async findBy{{capitalize name}}({{name}}: {{{tsType}}}): Promise<{{../entityName}} | null> {
    const snapshot = await this.getCollection()
      .where('{{name}}', '==', {{name}})
      .where('deletedAt', '==', null)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return this.fromFirestore(doc.id, doc.data());
  }
{{/if}}
{{/each}}

{{#each fields}}
{{#if encryptedUnique}}
  /**
   * Note: {{name}} is marked unique but is encrypted ({{encryption}} mode).
   * Firestore cannot query encrypted values by plaintext.
   * To support lookups, implement a blind index (deterministic HMAC)
   * stored alongside the ciphertext.
   */
{{/if}}
{{/each}}

{{#each relationships}}
  /**
   * Get {{name}} for {{../entityName}}
   */
  async get{{capitalize name}}({{../entityNameLower}}Id: string): Promise<{{entity}}[]> {
    // Implementation depends on relationship type
    // TODO: Implement relationship query
    return [];
  }
{{/each}}
}
{{/if}}
`;

/**
 * Service Template
 * Generates service class for business logic
 */
export const SERVICE_TEMPLATE = `/**
 * {{entityName}} Service
 * Generated from data model specification
 */

{{#if isSubcollection}}
import { RequestContext, ServiceResult, QueryOptions } from '@xbg.solutions/backend-core';
import { eventBus } from '@xbg.solutions/utils-events';
import { logger } from '@xbg.solutions/utils-logger';
import { {{entityName}}, {{entityName}}Data } from '../entities/{{entityName}}';
import { {{entityName}}Repository } from '../repositories/{{entityName}}Repository';

/**
 * Service for {{entityName}} subcollection entities.
 * Operates within the scope of a parent {{parentEntity}}.
 */
export class {{entityName}}Service {
  protected entityName = '{{entityName}}';

  constructor(protected repository: {{entityName}}Repository) {}

  async create(data: Partial<{{entityName}}Data>, context: RequestContext): Promise<ServiceResult<{{entityName}}>> {
    try {
      logger.info(\`Creating {{entityName}}\`, { requestId: context.requestId });
      const entity = new {{entityName}}(data as {{entityName}}Data);
      const validation = entity.validate();
      if (!validation.valid) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: validation.errors.join(', ') } };
      }
      // Pass serialized fields so encryption (if configured) is applied
      const result = await this.repository.create(entity.serializeFields());
      this.publishEvent('CREATED', result, context);
      return { success: true, data: result };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(\`Failed to create {{entityName}}\`, err, { requestId: context.requestId });
      return { success: false, error: { code: 'CREATE_ERROR', message: err.message } };
    }
  }

  async findById(id: string, context: RequestContext): Promise<ServiceResult<{{entityName}}>> {
    try {
      const entity = await this.repository.findById(id);
      if (!entity) {
        return { success: false, error: { code: 'NOT_FOUND', message: \`{{entityName}} not found: \${id}\` } };
      }
      return { success: true, data: entity };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(\`Failed to find {{entityName}}\`, err, { requestId: context.requestId });
      return { success: false, error: { code: 'READ_ERROR', message: err.message } };
    }
  }

  async findAll(options: QueryOptions, context: RequestContext): Promise<ServiceResult<{{entityName}}[]>> {
    try {
      const entities = await this.repository.findAll(options);
      return { success: true, data: entities };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(\`Failed to find {{entityName}} list\`, err, { requestId: context.requestId });
      return { success: false, error: { code: 'READ_ERROR', message: err.message } };
    }
  }

  async update(id: string, data: Partial<{{entityName}}Data>, context: RequestContext): Promise<ServiceResult<{{entityName}}>> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) {
        return { success: false, error: { code: 'NOT_FOUND', message: \`{{entityName}} not found: \${id}\` } };
      }
      // Merge with existing, rebuild entity to apply encryption via serializeFields()
      const merged = { ...existing.toJSON(), ...data, id: existing.id };
      const updatedEntity = new {{entityName}}(merged as {{entityName}}Data);
      const validation = updatedEntity.validate();
      if (!validation.valid) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: validation.errors.join(', ') } };
      }
      await this.repository.updateFields(id, updatedEntity.serializeFields());
      const updated = await this.repository.findById(id);
      if (updated) {
        this.publishEvent('UPDATED', updated, context);
      }
      return { success: true, data: updated! };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(\`Failed to update {{entityName}}\`, err, { requestId: context.requestId });
      return { success: false, error: { code: 'UPDATE_ERROR', message: err.message } };
    }
  }

  async delete(id: string, context: RequestContext): Promise<ServiceResult<void>> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) {
        return { success: false, error: { code: 'NOT_FOUND', message: \`{{entityName}} not found: \${id}\` } };
      }
      await this.repository.remove(id);
      this.publishEvent('DELETED', existing, context);
      return { success: true };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(\`Failed to delete {{entityName}}\`, err, { requestId: context.requestId });
      return { success: false, error: { code: 'DELETE_ERROR', message: err.message } };
    }
  }

  protected publishEvent(action: string, entity: {{entityName}}, context: RequestContext): void {
    try {
      eventBus.publish(\`{{entityName}}.\${action}\` as any, {
        entityId: entity.id,
        entityType: '{{entityName}}',
        action,
        data: entity.toJSON(),
        context: { userId: context.userId, requestId: context.requestId },
        timestamp: new Date(),
      });
    } catch (err) {
      logger.warn('Failed to publish event', { action, entityName: '{{entityName}}' });
    }
  }

{{#if businessRules}}
  /**
   * Business Rules:
{{#each businessRules}}
   * - {{this}}
{{/each}}
   */
{{/if}}
}
{{else}}
import { BaseService, RequestContext } from '@xbg.solutions/backend-core';
import { {{entityName}}, {{entityName}}Data } from '../entities/{{entityName}}';
import { {{entityName}}Repository } from '../repositories/{{entityName}}Repository';

export class {{entityName}}Service extends BaseService<{{entityName}}> {
  protected entityName = '{{entityName}}';

  constructor(repository: {{entityName}}Repository) {
    super(repository);
  }

  /**
   * Build entity from partial data
   */
  protected async buildEntity(data: Partial<{{entityName}}Data>): Promise<{{entityName}}> {
    return new {{entityName}}(data as {{entityName}}Data);
  }

  /**
   * Merge existing entity with updates
   */
  protected async mergeEntity(existing: {{entityName}}, updates: Partial<{{entityName}}Data>): Promise<{{entityName}}> {
    if (!existing.id) {
      throw new Error('Cannot merge {{entityName}} without an ID');
    }
    return new {{entityName}}({
      ...existing.toJSON(),
      ...updates,
      id: existing.id,
    });
  }

{{#if accessRules}}
  /**
   * Check read access
   */
  protected async checkReadAccess(entity: {{entityName}}, context: RequestContext): Promise<boolean> {
    {{#if accessRules.read}}
    const allowedRoles = [{{#each accessRules.read}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}];

    // Check if user has required role
    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    // Check if user owns the resource
    if (allowedRoles.includes('self')) {
      // TODO: Implement ownership check based on your entity structure
      return true;
    }

    return false;
    {{else}}
    return true;
    {{/if}}
  }

  /**
   * Check update access
   */
  protected async checkUpdateAccess(entity: {{entityName}}, context: RequestContext): Promise<boolean> {
    {{#if accessRules.update}}
    const allowedRoles = [{{#each accessRules.update}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}];

    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    if (allowedRoles.includes('self')) {
      // TODO: Implement ownership check
      return true;
    }

    return false;
    {{else}}
    return true;
    {{/if}}
  }

  /**
   * Check delete access
   */
  protected async checkDeleteAccess(entity: {{entityName}}, context: RequestContext): Promise<boolean> {
    {{#if accessRules.delete}}
    const allowedRoles = [{{#each accessRules.delete}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}];

    if (context.userRole && allowedRoles.includes(context.userRole)) {
      return true;
    }

    return false;
    {{else}}
    return true;
    {{/if}}
  }
{{/if}}

{{#if businessRules}}
  /**
   * Business Rules:
{{#each businessRules}}
   * - {{this}}
{{/each}}
   */
{{/if}}
}
{{/if}}
`;

/**
 * Controller Template
 * Generates controller class for HTTP endpoints
 */
export const CONTROLLER_TEMPLATE = `/**
 * {{entityName}} Controller
 * Generated from data model specification
 */

{{#if isSubcollection}}
import { Router, Request, Response, NextFunction } from 'express';
import { RepositoryFactory } from '@xbg.solutions/backend-core';
import { {{entityName}} } from '../entities/{{entityName}}';
import { {{entityName}}Repository } from '../repositories/{{entityName}}Repository';
import { {{entityName}}Service } from '../services/{{entityName}}Service';

/**
 * Controller for {{entityName}} subcollection.
 * Route pattern: /{{parentEntityLower}}s/:{{parentEntityLower}}Id/{{collectionName}}
 */
export class {{entityName}}Controller {
  public router: Router;
  private factory: RepositoryFactory;

  constructor(factory: RepositoryFactory) {
    this.factory = factory;
    this.router = Router({ mergeParams: true });
    this.registerRoutes();
  }

  protected registerRoutes(): void {
    this.router.post('/', this.handleCreate.bind(this));
    this.router.get('/', this.handleFindAll.bind(this));
    this.router.get('/:id', this.handleFindById.bind(this));
    this.router.put('/:id', this.handleUpdate.bind(this));
    this.router.patch('/:id', this.handleUpdate.bind(this));
    this.router.delete('/:id', this.handleDelete.bind(this));
  }

  private createService(req: Request): {{entityName}}Service {
    const {{parentEntityLower}}Id = req.params.{{parentEntityLower}}Id;
    const parentPath = ['{{subcollectionName}}', {{parentEntityLower}}Id, '{{collectionName}}'];
    const repository = new {{entityName}}Repository(this.factory, parentPath);
    return new {{entityName}}Service(repository);
  }

  private createContext(req: Request) {
    return {
      requestId: (req.headers['x-request-id'] as string) || 'unknown',
      userId: (req as any).user?.uid,
      userRole: (req as any).user?.role,
      timestamp: new Date(),
    };
  }

  protected async handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.createService(req);
      const context = this.createContext(req);
      const result = await service.create(req.body, context);
      if (result.success) {
        res.status(201).json({ success: true, data: result.data });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      next(error);
    }
  }

  protected async handleFindAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.createService(req);
      const context = this.createContext(req);
      const result = await service.findAll({}, context);
      if (result.success) {
        res.json({ success: true, data: result.data });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      next(error);
    }
  }

  protected async handleFindById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.createService(req);
      const context = this.createContext(req);
      const result = await service.findById(req.params.id, context);
      if (result.success) {
        res.json({ success: true, data: result.data });
      } else {
        const status = result.error?.code === 'NOT_FOUND' ? 404 : 500;
        res.status(status).json({ success: false, error: result.error });
      }
    } catch (error) {
      next(error);
    }
  }

  protected async handleUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.createService(req);
      const context = this.createContext(req);
      const result = await service.update(req.params.id, req.body, context);
      if (result.success) {
        res.json({ success: true, data: result.data });
      } else {
        const status = result.error?.code === 'NOT_FOUND' ? 404 : 400;
        res.status(status).json({ success: false, error: result.error });
      }
    } catch (error) {
      next(error);
    }
  }

  protected async handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const service = this.createService(req);
      const context = this.createContext(req);
      const result = await service.delete(req.params.id, context);
      if (result.success) {
        res.status(204).send();
      } else {
        const status = result.error?.code === 'NOT_FOUND' ? 404 : 500;
        res.status(status).json({ success: false, error: result.error });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get the router for mounting.
   * Mount at: /{{parentEntityLower}}s/:{{parentEntityLower}}Id/{{collectionName}}
   */
  getRouter(): Router {
    return this.router;
  }
}
{{else}}
import { BaseController } from '@xbg.solutions/backend-core';
import { {{entityName}} } from '../entities/{{entityName}}';
import { {{entityName}}Service } from '../services/{{entityName}}Service';

export class {{entityName}}Controller extends BaseController<{{entityName}}> {
  constructor(service: {{entityName}}Service, basePath = '/{{entityNameLower}}s') {
    super(service, basePath);
  }

  /**
   * Register custom routes
   */
  protected registerRoutes(): void {
    // Register standard CRUD routes
    super.registerRoutes();

    // Add custom routes here
{{#each fields}}
{{#if unique}}
    // this.router.get('/by-{{name}}/:{{name}}', this.handleFindBy{{capitalize name}}.bind(this));
{{/if}}
{{/each}}
  }

{{#each fields}}
{{#if unique}}
  /**
   * Find {{../entityName}} by {{name}}
   */
  // protected async handleFindBy{{capitalize name}}(req: Request, res: Response, next: NextFunction): Promise<void> {
  //   try {
  //     const context = this.createContext(req);
  //     const { {{name}} } = req.params;
  //
  //     // Implementation here
  //   } catch (error) {
  //     next(error);
  //   }
  // }
{{/if}}
{{/each}}
}
{{/if}}
`;

/**
 * Get template by name
 */
export function getTemplate(name: string): string {
  switch (name) {
    case 'entity':
      return ENTITY_TEMPLATE;
    case 'repository':
      return REPOSITORY_TEMPLATE;
    case 'service':
      return SERVICE_TEMPLATE;
    case 'controller':
      return CONTROLLER_TEMPLATE;
    default:
      throw new Error(`Unknown template: ${name}`);
  }
}
