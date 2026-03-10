/**
 * Error Utilities Tests
 */

import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
} from '../app-errors';

describe('Error Utilities', () => {
  describe('AppError', () => {
    it('should create an error with all properties', () => {
      const error = new AppError(400, 'Test error', true, { field: 'test' });

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Test error');
      expect(error.isOperational).toBe(true);
      expect(error.details).toEqual({ field: 'test' });
      expect(error.stack).toBeDefined();
    });

    it('should default isOperational to true', () => {
      const error = new AppError(500, 'Error');

      expect(error.isOperational).toBe(true);
    });

    it('should be an instance of Error', () => {
      const error = new AppError(500, 'Error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should capture stack trace', () => {
      const error = new AppError(500, 'Error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Error');
    });
  });

  describe('ValidationError', () => {
    it('should create a 400 error', () => {
      const error = new ValidationError('Invalid input');

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
      expect(error.isOperational).toBe(true);
    });

    it('should accept details', () => {
      const details = {
        field: 'email',
        issue: 'Invalid format',
      };
      const error = new ValidationError('Invalid email', details);

      expect(error.details).toEqual(details);
    });

    it('should be instance of AppError', () => {
      const error = new ValidationError('Invalid');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create a 401 error', () => {
      const error = new UnauthorizedError('Not authenticated');

      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Not authenticated');
      expect(error.isOperational).toBe(true);
    });

    it('should have default message', () => {
      const error = new UnauthorizedError();

      expect(error.message).toBe('Unauthorized');
    });

    it('should be instance of AppError', () => {
      const error = new UnauthorizedError();

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('ForbiddenError', () => {
    it('should create a 403 error', () => {
      const error = new ForbiddenError('No permission');

      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('No permission');
      expect(error.isOperational).toBe(true);
    });

    it('should have default message', () => {
      const error = new ForbiddenError();

      expect(error.message).toBe('Forbidden');
    });

    it('should be instance of AppError', () => {
      const error = new ForbiddenError();

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ForbiddenError);
    });
  });

  describe('NotFoundError', () => {
    it('should create a 404 error with resource name', () => {
      const error = new NotFoundError('User');

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
      expect(error.isOperational).toBe(true);
    });

    it('should handle different resource names', () => {
      expect(new NotFoundError('Order').message).toBe('Order not found');
      expect(new NotFoundError('Product').message).toBe('Product not found');
      expect(new NotFoundError('Entity').message).toBe('Entity not found');
    });

    it('should be instance of AppError', () => {
      const error = new NotFoundError('Resource');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(NotFoundError);
    });
  });

  describe('ConflictError', () => {
    it('should create a 409 error', () => {
      const error = new ConflictError('Email already exists');

      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Email already exists');
      expect(error.isOperational).toBe(true);
    });

    it('should be instance of AppError', () => {
      const error = new ConflictError('Conflict');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  describe('InternalServerError', () => {
    it('should create a 500 error', () => {
      const error = new InternalServerError('Server crashed');

      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Server crashed');
    });

    it('should have default message', () => {
      const error = new InternalServerError();

      expect(error.message).toBe('Internal server error');
    });

    it('should have isOperational false', () => {
      const error = new InternalServerError();

      expect(error.isOperational).toBe(false);
    });

    it('should accept details', () => {
      const details = { originalError: 'Database connection failed' };
      const error = new InternalServerError('DB Error', details);

      expect(error.details).toEqual(details);
    });

    it('should be instance of AppError', () => {
      const error = new InternalServerError();

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(InternalServerError);
    });
  });

  describe('Error instanceof checks', () => {
    it('should allow discriminating errors by type', () => {
      const errors = [
        new ValidationError('Invalid'),
        new UnauthorizedError(),
        new NotFoundError('User'),
      ];

      errors.forEach(error => {
        if (error instanceof ValidationError) {
          expect(error.statusCode).toBe(400);
        } else if (error instanceof UnauthorizedError) {
          expect(error.statusCode).toBe(401);
        } else if (error instanceof NotFoundError) {
          expect(error.statusCode).toBe(404);
        }
      });
    });
  });

  describe('Error catching', () => {
    it('should be catchable with try-catch', () => {
      const throwError = () => {
        throw new ValidationError('Test error');
      };

      expect(() => throwError()).toThrow(ValidationError);
      expect(() => throwError()).toThrow(AppError);
      expect(() => throwError()).toThrow('Test error');
    });

    it('should preserve error type when caught', () => {
      try {
        throw new NotFoundError('User');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toBeInstanceOf(AppError);

        if (error instanceof NotFoundError) {
          expect(error.statusCode).toBe(404);
        }
      }
    });
  });
});
