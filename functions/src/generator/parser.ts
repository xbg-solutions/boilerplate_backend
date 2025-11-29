/**
 * Data Model Parser
 * Converts EntitySpecification to template context
 */

import {
  EntitySpecification,
  FieldDefinition,
  RelationshipDefinition,
  TemplateContext,
  FieldContext,
  RelationshipContext,
  FieldType,
} from './types';

/**
 * Parse entity specification into template context
 */
export function parseEntitySpecification(
  entityName: string,
  spec: EntitySpecification,
  collectionName?: string
): TemplateContext {
  const fields = parseFields(spec.fields);
  const relationships = parseRelationships(spec.relationships || {});

  return {
    entityName,
    entityNameLower: toLowerCamelCase(entityName),
    entityNamePlural: pluralize(entityName),
    collectionName: collectionName || toSnakeCase(pluralize(entityName)),
    fields,
    relationships,
    imports: generateImports(fields, relationships),
    hasTimestamps: hasTimestampFields(fields),
    hasSoftDelete: hasSoftDeleteField(fields),
    hasValidation: fields.some((f) => f.validation.length > 0),
    accessRules: spec.access,
    indexes: spec.indexes,
    businessRules: spec.businessRules,
  };
}

/**
 * Parse field definitions
 */
function parseFields(fields: Record<string, FieldDefinition>): FieldContext[] {
  return Object.entries(fields).map(([name, def]) => ({
    name,
    type: def.type,
    tsType: mapFieldTypeToTypeScript(def),
    required: def.required || false,
    unique: def.unique || false,
    hasDefault: def.default !== undefined,
    defaultValue: formatDefaultValue(def.default, def.type),
    validation: generateValidationRules(name, def),
    description: def.description,
  }));
}

/**
 * Parse relationship definitions
 */
function parseRelationships(relationships: Record<string, RelationshipDefinition>): RelationshipContext[] {
  return Object.entries(relationships).map(([name, def]) => ({
    name,
    type: def.type,
    entity: def.entity || '',
    cascadeDelete: def.cascadeDelete || false,
    description: def.description,
  }));
}

/**
 * Map field type to TypeScript type
 */
function mapFieldTypeToTypeScript(field: FieldDefinition): string {
  const baseType = (() => {
    switch (field.type) {
      case 'string':
      case 'email':
      case 'url':
      case 'uuid':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'timestamp':
      case 'date':
        return 'Timestamp | FieldValue';
      case 'enum':
        return field.values ? field.values.map((v) => `'${v}'`).join(' | ') : 'string';
      case 'array':
        return 'any[]';
      case 'nested':
        return field.schema || 'Record<string, any>';
      case 'reference':
        return 'string';
      case 'json':
        return 'Record<string, any>';
      default:
        return 'any';
    }
  })();

  return field.nullable ? `${baseType} | null` : baseType;
}

/**
 * Format default value for code generation
 */
function formatDefaultValue(value: any, type: FieldType): string | undefined {
  if (value === undefined) return undefined;

  switch (type) {
    case 'string':
    case 'email':
    case 'url':
    case 'uuid':
    case 'enum':
      return `'${value}'`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'timestamp':
    case 'date':
      return 'FieldValue.serverTimestamp()';
    case 'array':
      return '[]';
    case 'json':
    case 'nested':
      return '{}';
    default:
      return 'undefined';
  }
}

/**
 * Generate validation rules for a field
 */
function generateValidationRules(fieldName: string, field: FieldDefinition): string[] {
  const rules: string[] = [];

  if (field.required) {
    rules.push(`ValidationHelper.required(this.${fieldName}, '${fieldName}')`);
  }

  if (field.type === 'email') {
    rules.push(`ValidationHelper.email(this.${fieldName}, '${fieldName}')`);
  }

  if (field.minLength !== undefined) {
    rules.push(`ValidationHelper.minLength(this.${fieldName}, ${field.minLength}, '${fieldName}')`);
  }

  if (field.maxLength !== undefined) {
    rules.push(`ValidationHelper.maxLength(this.${fieldName}, ${field.maxLength}, '${fieldName}')`);
  }

  if (field.min !== undefined || field.max !== undefined) {
    const min = field.min || 0;
    const max = field.max || Number.MAX_SAFE_INTEGER;
    rules.push(`ValidationHelper.range(this.${fieldName}, ${min}, ${max}, '${fieldName}')`);
  }

  if (field.pattern) {
    rules.push(`ValidationHelper.pattern(this.${fieldName}, /${field.pattern}/, '${fieldName}')`);
  }

  if (field.values) {
    const values = field.values.map((v) => `'${v}'`).join(', ');
    rules.push(`ValidationHelper.oneOf(this.${fieldName}, [${values}], '${fieldName}')`);
  }

  return rules;
}

/**
 * Generate imports based on fields and relationships
 */
function generateImports(fields: FieldContext[], relationships: RelationshipContext[]): string[] {
  const imports: string[] = [
    "import { BaseEntity, ValidationResult, ValidationHelper } from '@base/BaseEntity';",
    "import { Timestamp, FieldValue } from 'firebase-admin/firestore';",
  ];

  // Add relationship imports
  const relatedEntities = new Set(relationships.map((r) => r.entity));
  relatedEntities.forEach((entity) => {
    imports.push(`import { ${entity} } from './${entity}';`);
  });

  return imports;
}

/**
 * Check if entity has timestamp fields
 */
function hasTimestampFields(fields: FieldContext[]): boolean {
  return fields.some((f) => f.name === 'createdAt' || f.name === 'updatedAt');
}

/**
 * Check if entity has soft delete field
 */
function hasSoftDeleteField(fields: FieldContext[]): boolean {
  return fields.some((f) => f.name === 'deletedAt');
}

/**
 * String manipulation helpers
 */
function toLowerCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function pluralize(str: string): string {
  // Simple pluralization (enhance as needed)
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies';
  }
  if (str.endsWith('s')) {
    return str + 'es';
  }
  return str + 's';
}
