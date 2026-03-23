/**
 * @xbg.solutions/backend-core
 * Core framework for XBG backend projects
 *
 * Exports base classes, middleware, configuration, types, and code generator
 */

// Base classes
export * from './base/BaseEntity';
export * from './base/BaseRepository';
export * from './base/BaseService';
export * from './base/BaseController';

// Middleware
export * from './middleware';

// Configuration
export * from './config';

// Types
export * from './types/errors';

// App factory
export { createApp, registerControllers, startServer } from './app';
export type { AppOptions } from './app';

// Code generator
export { CodeGenerator, createGenerator } from './generator/generator';
export { parseEntitySpecification } from './generator/parser';
export type {
  DataModelSpecification,
  EntitySpecification,
  FieldDefinition,
  FieldType,
  RelationshipDefinition,
  RelationshipType,
  AccessControlRules,
  ValidationRules,
  IndexDefinition,
  WorkflowSpecification,
  GeneratorConfig,
  TemplateContext,
  FieldContext,
  RelationshipContext,
} from './generator/types';
