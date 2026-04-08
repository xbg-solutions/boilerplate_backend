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
  AncestorSegment,
  FieldType,
} from './types';

/**
 * Parse entity specification into template context
 */
export function parseEntitySpecification(
  entityName: string,
  spec: EntitySpecification,
  collectionName?: string,
  allEntities?: Record<string, EntitySpecification>
): TemplateContext {
  const fields = parseFields(spec.fields);
  const relationships = parseRelationships(spec.relationships || {}, allEntities);
  const isSubcollection = spec.storage?.type === 'subcollection';
  const ancestorChain = allEntities ? resolveAncestorChain(spec, allEntities) : [];

  // Compute encryption aggregates
  const { transparentFields, guardedFields } = collectEncryptedFields(spec.fields);
  const hasTransparentFields = transparentFields.length > 0;
  const hasGuardedFields = guardedFields.length > 0;
  const hasEncryption = hasTransparentFields || hasGuardedFields;

  return {
    entityName,
    entityNameLower: toLowerCamelCase(entityName),
    entityNamePlural: pluralize(entityName),
    collectionName: collectionName || spec.storage?.collectionName || toLowerCamelCase(pluralize(entityName)),
    fields,
    relationships,
    imports: generateImports(fields, relationships, isSubcollection, hasEncryption, entityName),
    hasTimestamps: hasTimestampFields(fields),
    hasSoftDelete: hasSoftDeleteField(fields),
    hasValidation: fields.some((f) => f.validation.length > 0),
    accessRules: spec.access,
    indexes: spec.indexes,
    businessRules: spec.businessRules,
    isSubcollection,
    parentEntity: isSubcollection ? spec.storage!.parent?.entity : undefined,
    parentEntityLower: isSubcollection && spec.storage!.parent?.entity
      ? toLowerCamelCase(spec.storage!.parent.entity)
      : undefined,
    parentCollectionName: isSubcollection ? spec.storage!.parent?.collectionName : undefined,
    ancestorChain,
    hasEncryption,
    hasTransparentFields,
    hasGuardedFields,
    transparentFields,
    guardedFields,
  };
}

/**
 * Base entity field names (should not be duplicated in generated entities)
 */
const BASE_ENTITY_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'version']);

/**
 * Parse field definitions
 */
function parseFields(fields: Record<string, FieldDefinition>): FieldContext[] {
  return Object.entries(fields).map(([name, def]) => ({
    name,
    type: def.type,
    tsType: mapFieldTypeToTypeScript(def),
    required: def.required || false,
    unique: (def.unique || false) && !def.encryption, // encrypted fields can't be queried by value
    hasDefault: def.default !== undefined,
    defaultValue: formatDefaultValue(def.default, def.type),
    validation: generateValidationRules(name, def),
    description: def.description,
    isBaseEntityField: BASE_ENTITY_FIELDS.has(name),
    encryption: def.encryption,
    encryptedUnique: (def.unique || false) && !!def.encryption,
  }));
}

/**
 * Parse relationship definitions
 */
function parseRelationships(
  relationships: Record<string, RelationshipDefinition>,
  allEntities?: Record<string, EntitySpecification>
): RelationshipContext[] {
  return Object.entries(relationships).map(([name, def]) => {
    const targetEntity = def.entity || '';
    const targetSpec = allEntities?.[targetEntity];

    let targetStorage: RelationshipContext['targetStorage'] | undefined;
    if (targetSpec && allEntities) {
      const targetIsSubcollection = targetSpec.storage?.type === 'subcollection';
      const targetCollName = targetSpec.storage?.collectionName
        || toLowerCamelCase(pluralize(targetEntity));
      targetStorage = {
        type: targetIsSubcollection ? 'subcollection' : 'collection',
        collectionName: targetCollName,
        ancestorChain: resolveAncestorChain(targetSpec, allEntities),
      };
    }

    return {
      name,
      type: def.type,
      entity: targetEntity,
      foreignKey: def.foreignKey,
      targetStorage,
      cascadeDelete: def.cascadeDelete || false,
      description: def.description,
    };
  });
}

/**
 * Resolve the full ancestor chain for a subcollection entity.
 * Walks up the parent chain via allEntities, building the path from root to immediate parent.
 */
function resolveAncestorChain(
  spec: EntitySpecification,
  allEntities: Record<string, EntitySpecification>
): AncestorSegment[] {
  const chain: AncestorSegment[] = [];
  let current = spec;
  const maxDepth = 10;

  while (current.storage?.type === 'subcollection' && current.storage.parent && chain.length < maxDepth) {
    const parent = current.storage.parent;
    const parentSpec = allEntities[parent.entity];

    chain.unshift({
      entity: parent.entity,
      entityLower: toLowerCamelCase(parent.entity),
      collectionName: parentSpec?.storage?.collectionName || parent.collectionName,
      paramName: parent.foreignKey || `${toLowerCamelCase(parent.entity)}Id`,
    });

    if (!parentSpec) break;
    current = parentSpec;
  }

  return chain;
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
        return typeof field.schema === 'string' ? field.schema : 'Record<string, any>';
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
 * Collect encrypted field names/dot-paths from the specification.
 * Handles flat fields, whole-nested-object encryption, and inline nested sub-field encryption.
 */
function collectEncryptedFields(fields: Record<string, FieldDefinition>): {
  transparentFields: string[];
  guardedFields: string[];
} {
  const transparentFields: string[] = [];
  const guardedFields: string[] = [];

  for (const [name, def] of Object.entries(fields)) {
    if (def.encryption) {
      // Flat field or whole nested object marked with encryption
      const target = def.encryption === 'transparent' ? transparentFields : guardedFields;
      target.push(name);
    } else if (def.type === 'nested' && typeof def.schema === 'object') {
      // Inline nested schema — check sub-fields for encryption
      for (const [subName, subDef] of Object.entries(def.schema)) {
        if (subDef.encryption) {
          const target = subDef.encryption === 'transparent' ? transparentFields : guardedFields;
          target.push(`${name}.${subName}`);
        }
      }
    }
  }

  return { transparentFields, guardedFields };
}

/**
 * Generate imports based on fields and relationships
 */
function generateImports(fields: FieldContext[], relationships: RelationshipContext[], isSubcollection?: boolean, hasEncryption?: boolean, entityName?: string): string[] {
  const coreImports = isSubcollection
    ? 'BaseEntity, BaseEntityData, ValidationResult, ValidationHelper, RepositoryFactory, IScopedRepository, QueryOptions'
    : 'BaseEntity, BaseEntityData, ValidationResult, ValidationHelper';

  const imports: string[] = [
    `import { ${coreImports} } from '@xbg.solutions/backend-core';`,
    "import { Timestamp, FieldValue } from 'firebase-admin/firestore';",
  ];

  if (hasEncryption) {
    imports.push("import { hashTransparentFields, unhashTransparentFields } from '@xbg.solutions/utils-hashing';");
  }

  // Add imports for relationship target entities (deduplicated, excluding self-references)
  const relatedEntities = new Set(
    relationships
      .filter((r) => r.targetStorage && r.entity !== entityName)
      .map((r) => r.entity)
  );
  for (const entity of relatedEntities) {
    imports.push(`import { ${entity} } from '../entities/${entity}';`);
  }

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
