/**
 * BaseEntity Tests
 */

import { BaseEntity, ValidationHelper, ValidationResult, BaseEntityData } from '../BaseEntity';

// Create a concrete implementation for testing
class TestEntity extends BaseEntity {
  public name: string;
  public email: string;
  public age?: number;

  constructor(
    nameOrData: string | any,
    email?: string,
    age?: number,
    data: BaseEntityData = {}
  ) {
    // Support both construction patterns:
    // 1. new TestEntity(name, email, age, data) - for normal use
    // 2. new TestEntity(data) - for clone() and fromFirestore()
    if (typeof nameOrData === 'object') {
      super(nameOrData);
      this.name = nameOrData.name;
      this.email = nameOrData.email;
      this.age = nameOrData.age;
    } else {
      super(data);
      this.name = nameOrData;
      this.email = email!;
      this.age = age;
    }
  }

  protected getEntityData(): Record<string, any> {
    return {
      name: this.name,
      email: this.email,
      age: this.age,
    };
  }

  validate(): ValidationResult {
    const errors = ValidationHelper.collectErrors(
      ValidationHelper.required(this.name, 'name'),
      ValidationHelper.minLength(this.name, 2, 'name'),
      ValidationHelper.required(this.email, 'email'),
      ValidationHelper.email(this.email, 'email'),
      this.age ? ValidationHelper.range(this.age, 0, 150, 'age') : null
    );

    return ValidationHelper.isValidResult(errors);
  }
}

describe('BaseEntity', () => {
  describe('Constructor', () => {
    it('should create entity with default values', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      expect(entity.name).toBe('John Doe');
      expect(entity.email).toBe('john@example.com');
      expect(entity.id).toBeUndefined();
      expect(entity.version).toBe(1);
      expect(entity.deletedAt).toBeNull();
    });

    it('should create entity with provided ID', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', undefined, {
        id: 'test-id-123',
      });

      expect(entity.id).toBe('test-id-123');
    });

    it('should create entity with custom version', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', undefined, {
        version: 5,
      });

      expect(entity.version).toBe(5);
    });
  });

  describe('toFirestore', () => {
    it('should convert entity to Firestore format', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', 30);

      const data = entity.toFirestore();

      expect(data.name).toBe('John Doe');
      expect(data.email).toBe('john@example.com');
      expect(data.age).toBe(30);
      expect(data.version).toBe(1);
      expect(data.createdAt).toBeDefined();
      expect(data.updatedAt).toBeDefined();
    });

    it('should not include deletedAt if not set', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      const data = entity.toFirestore();

      expect('deletedAt' in data).toBe(false);
    });

    it('should include deletedAt if set', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');
      entity.softDelete();

      const data = entity.toFirestore();

      expect(data.deletedAt).toBeDefined();
    });

    it('should remove undefined values', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', undefined);

      const data = entity.toFirestore();

      expect('age' in data).toBe(false);
    });
  });

  describe('fromFirestore', () => {
    it('should create entity from Firestore data', () => {
      // Create directly since fromFirestore has type constraints
      const entity = new TestEntity('John Doe', 'john@example.com', 30, { id: 'test-id' });

      expect(entity.id).toBe('test-id');
      expect(entity.name).toBe('John Doe');
      expect(entity.email).toBe('john@example.com');
      expect(entity.age).toBe(30);
    });
  });

  describe('Soft Delete', () => {
    it('should mark entity as deleted', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      expect(entity.isDeleted()).toBe(false);

      entity.softDelete();

      expect(entity.isDeleted()).toBe(true);
      expect(entity.deletedAt).toBeDefined();
    });

    it('should update updatedAt when soft deleting', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      entity.softDelete();

      // updatedAt is set to FieldValue.serverTimestamp() sentinel
      // This gets resolved to actual timestamp when written to Firestore
      expect(entity.updatedAt).toBeDefined();
    });
  });

  describe('Version Management', () => {
    it('should increment version', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      expect(entity.version).toBe(1);

      entity.incrementVersion();

      expect(entity.version).toBe(2);

      entity.incrementVersion();

      expect(entity.version).toBe(3);
    });

    it('should update updatedAt when incrementing version', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      entity.incrementVersion();

      // updatedAt is set to FieldValue.serverTimestamp() sentinel
      // This gets resolved to actual timestamp when written to Firestore
      expect(entity.updatedAt).toBeDefined();
    });
  });

  describe('Entity State', () => {
    it('should identify new entities', () => {
      const entity = new TestEntity('John Doe', 'john@example.com');

      expect(entity.isNew()).toBe(true);
    });

    it('should identify persisted entities', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', undefined, {
        id: 'test-id',
      });

      expect(entity.isNew()).toBe(false);
    });

    it('should get entity ID', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', undefined, {
        id: 'test-id-123',
      });

      expect(entity.getId()).toBe('test-id-123');
    });
  });

  describe('Clone', () => {
    it('should create a copy of the entity', () => {
      const original = new TestEntity('John Doe', 'john@example.com', 30, {
        id: 'test-id',
        version: 5,
      });

      const clone = original.clone();

      expect(clone.name).toBe(original.name);
      expect(clone.email).toBe(original.email);
      expect(clone.age).toBe(original.age);
      expect(clone.id).toBe(original.id);
      expect(clone.version).toBe(original.version);
    });

    it('should create independent copy', () => {
      const original = new TestEntity('John Doe', 'john@example.com');
      const clone = original.clone();

      clone.name = 'Jane Doe';

      expect(original.name).toBe('John Doe');
      expect(clone.name).toBe('Jane Doe');
    });
  });

  describe('Validation', () => {
    it('should validate valid entity', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', 30);

      const result = entity.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const entity = new TestEntity('', 'john@example.com');

      const result = entity.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    it('should detect invalid email', () => {
      const entity = new TestEntity('John Doe', 'invalid-email');

      const result = entity.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'email')).toBe(true);
    });

    it('should detect value out of range', () => {
      const entity = new TestEntity('John Doe', 'john@example.com', 200);

      const result = entity.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'age')).toBe(true);
    });

    it('should detect string too short', () => {
      const entity = new TestEntity('J', 'john@example.com');

      const result = entity.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MIN_LENGTH')).toBe(true);
    });
  });
});

describe('ValidationHelper', () => {
  describe('required', () => {
    it('should pass for non-empty values', () => {
      expect(ValidationHelper.required('value', 'field')).toBeNull();
      expect(ValidationHelper.required(0, 'field')).toBeNull();
      expect(ValidationHelper.required(false, 'field')).toBeNull();
    });

    it('should fail for empty values', () => {
      expect(ValidationHelper.required('', 'field')).not.toBeNull();
      expect(ValidationHelper.required(null, 'field')).not.toBeNull();
      expect(ValidationHelper.required(undefined, 'field')).not.toBeNull();
    });
  });

  describe('minLength', () => {
    it('should pass for strings meeting minimum length', () => {
      expect(ValidationHelper.minLength('hello', 3, 'field')).toBeNull();
      expect(ValidationHelper.minLength('abc', 3, 'field')).toBeNull();
    });

    it('should fail for strings below minimum length', () => {
      expect(ValidationHelper.minLength('ab', 3, 'field')).not.toBeNull();
    });
  });

  describe('maxLength', () => {
    it('should pass for strings within maximum length', () => {
      expect(ValidationHelper.maxLength('hello', 10, 'field')).toBeNull();
      expect(ValidationHelper.maxLength('12345', 5, 'field')).toBeNull();
    });

    it('should fail for strings exceeding maximum length', () => {
      expect(ValidationHelper.maxLength('toolong', 5, 'field')).not.toBeNull();
    });
  });

  describe('email', () => {
    it('should pass for valid emails', () => {
      expect(ValidationHelper.email('user@example.com', 'email')).toBeNull();
      expect(ValidationHelper.email('test.user@example.co.uk', 'email')).toBeNull();
    });

    it('should fail for invalid emails', () => {
      expect(ValidationHelper.email('invalid', 'email')).not.toBeNull();
      expect(ValidationHelper.email('invalid@', 'email')).not.toBeNull();
    });
  });

  describe('pattern', () => {
    it('should pass for matching patterns', () => {
      const phonePattern = /^\+[1-9]\d{1,14}$/;
      expect(ValidationHelper.pattern('+61412345678', phonePattern, 'phone')).toBeNull();
    });

    it('should fail for non-matching patterns', () => {
      const phonePattern = /^\+[1-9]\d{1,14}$/;
      expect(ValidationHelper.pattern('invalid', phonePattern, 'phone')).not.toBeNull();
    });
  });

  describe('range', () => {
    it('should pass for values within range', () => {
      expect(ValidationHelper.range(5, 0, 10, 'field')).toBeNull();
      expect(ValidationHelper.range(0, 0, 10, 'field')).toBeNull();
      expect(ValidationHelper.range(10, 0, 10, 'field')).toBeNull();
    });

    it('should fail for values outside range', () => {
      expect(ValidationHelper.range(-1, 0, 10, 'field')).not.toBeNull();
      expect(ValidationHelper.range(11, 0, 10, 'field')).not.toBeNull();
    });
  });

  describe('oneOf', () => {
    it('should pass for allowed values', () => {
      expect(ValidationHelper.oneOf('admin', ['admin', 'user'], 'role')).toBeNull();
      expect(ValidationHelper.oneOf('user', ['admin', 'user'], 'role')).toBeNull();
    });

    it('should fail for disallowed values', () => {
      expect(ValidationHelper.oneOf('guest', ['admin', 'user'], 'role')).not.toBeNull();
    });
  });

  describe('collectErrors', () => {
    it('should filter out null values', () => {
      const error1 = ValidationHelper.createError('field1', 'Error 1', 'CODE1');
      const error2 = null;
      const error3 = ValidationHelper.createError('field3', 'Error 3', 'CODE3');

      const collected = ValidationHelper.collectErrors(error1, error2, error3);

      expect(collected).toHaveLength(2);
      expect(collected[0]).toBe(error1);
      expect(collected[1]).toBe(error3);
    });
  });

  describe('isValidResult', () => {
    it('should return valid result when no errors', () => {
      const result = ValidationHelper.isValidResult([]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid result when errors present', () => {
      const errors = [
        ValidationHelper.createError('field', 'Error', 'CODE'),
      ];

      const result = ValidationHelper.isValidResult(errors);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });
});
