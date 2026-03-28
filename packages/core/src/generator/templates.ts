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
    return {
{{#each fields}}
{{#unless isBaseEntityField}}
      {{name}}: this.{{name}},
{{/unless}}
{{/each}}
    };
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
  static fromFirestore(id: string, data: Record<string, any>): {{entityName}} {
    return new {{entityName}}({
      id,
      ...data,
    });
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
`;

/**
 * Service Template
 * Generates service class for business logic
 */
export const SERVICE_TEMPLATE = `/**
 * {{entityName}} Service
 * Generated from data model specification
 */

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
`;

/**
 * Controller Template
 * Generates controller class for HTTP endpoints
 */
export const CONTROLLER_TEMPLATE = `/**
 * {{entityName}} Controller
 * Generated from data model specification
 */

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
