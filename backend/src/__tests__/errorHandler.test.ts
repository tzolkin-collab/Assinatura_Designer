import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler, createError, type AppError } from '../middleware/errorHandler';

describe('errorHandler middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction = vi.fn();

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createError', () => {
    it('should create an error with statusCode and message', () => {
      const error = createError(404, 'Not Found');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Not Found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBeUndefined();
    });

    it('should create an error with statusCode, message, and code', () => {
      const error = createError(400, 'Bad Request', 'INVALID_INPUT');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Bad Request');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('INVALID_INPUT');
    });
  });

  describe('errorHandler', () => {
    it('should handle error with default values if not provided', () => {
      const error = new Error() as AppError;

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(console.error).toHaveBeenCalledWith('[ERROR] 500 - Internal server error');
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        },
      });
    });

    it('should use provided statusCode, message, and code', () => {
      const error = createError(403, 'Forbidden', 'AUTH_ERROR');

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(console.error).toHaveBeenCalledWith('[ERROR] 403 - Forbidden');
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Forbidden',
          code: 'AUTH_ERROR',
        },
      });
    });

    it('should include stack trace in development environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = createError(500, 'Dev Error');
      error.stack = 'Error stack trace';

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Dev Error',
          code: 'INTERNAL_ERROR',
          stack: 'Error stack trace',
        },
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in non-development environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = createError(500, 'Prod Error');
      error.stack = 'Error stack trace';

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Prod Error',
          code: 'INTERNAL_ERROR',
        },
      });

      process.env.NODE_ENV = originalEnv;
    });
  });
});
