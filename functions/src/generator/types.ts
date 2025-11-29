/**
 * Data Model Specification Types
 * Defines the format for Claude Code CLI input
 */

export interface DataModelSpecification {
  entities: Record<string, EntitySpecification>;
  workflows?: Record<string, WorkflowSpecification>;
}

export interface EntitySpecification {
  fields: Record<string, FieldDefinition>;
  relationships?: Record<string, RelationshipDefinition>;
  access?: AccessControlRules;
  validation?: ValidationRules;
  indexes?: IndexDefinition[];
  businessRules?: string[];
  description?: string;
}

export interface FieldDefinition {
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: any;
  generated?: boolean;
  auto?: boolean;
  nullable?: boolean;
  primaryKey?: boolean;
  values?: string[]; // For enum types
  schema?: string; // For nested types
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  description?: string;
}

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'email'
  | 'url'
  | 'uuid'
  | 'enum'
  | 'array'
  | 'nested'
  | 'reference'
  | 'json';

export interface RelationshipDefinition {
  type: RelationshipType;
  entity?: string;
  through?: string;
  foreignKey?: string;
  cascadeDelete?: boolean;
  description?: string;
}

export type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface AccessControlRules {
  create?: string[];
  read?: string[];
  update?: string[];
  delete?: string[];
}

export interface ValidationRules {
  [fieldName: string]: string;
}

export interface IndexDefinition {
  fields: string[];
  unique?: boolean;
  description?: string;
}

export interface WorkflowSpecification {
  trigger: 'manual' | string; // EventType or 'manual'
  steps: string[];
  conditions?: Record<string, string>;
  description?: string;
}

/**
 * Generated Code Configuration
 */
export interface GeneratorConfig {
  outputDir: string;
  entityName: string;
  collectionName: string;
  generateTests?: boolean;
  generateDocs?: boolean;
}

/**
 * Template Context for Code Generation
 */
export interface TemplateContext {
  entityName: string;
  entityNameLower: string;
  entityNamePlural: string;
  collectionName: string;
  fields: FieldContext[];
  relationships: RelationshipContext[];
  imports: string[];
  hasTimestamps: boolean;
  hasSoftDelete: boolean;
  hasValidation: boolean;
  accessRules?: AccessControlRules;
  indexes?: IndexDefinition[];
  businessRules?: string[];
}

export interface FieldContext {
  name: string;
  type: string;
  tsType: string;
  required: boolean;
  unique: boolean;
  hasDefault: boolean;
  defaultValue?: string;
  validation: string[];
  description?: string;
}

export interface RelationshipContext {
  name: string;
  type: RelationshipType;
  entity: string;
  cascadeDelete: boolean;
  description?: string;
}
