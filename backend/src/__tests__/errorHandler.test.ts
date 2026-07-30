import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { errorHandler, createError, AppError } from '../middleware/errorHandler';
import type { Request, Response, NextFunction } from 'express';

describe('errorHandler middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    mockNext = vi.fn();

    // Silence console.error
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('includes stack trace in response when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';

    const err = new Error('Test error') as AppError;
    err.stack = 'Error stack trace details';

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Test error',
        code: 'INTERNAL_ERROR',
        stack: 'Error stack trace details'
      }
    });
  });

  it('does not include stack trace in response when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';

    const err = new Error('Production error') as AppError;
    err.stack = 'Sensitive stack trace';

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Production error',
        code: 'INTERNAL_ERROR'
      }
    });
  });

  it('uses error statusCode, code, and message when provided', () => {
    const err = createError(400, 'Bad request', 'BAD_REQUEST');

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Bad request',
          code: 'BAD_REQUEST'
        })
      })
    );
  });

  it('defaults to 500 status and "Internal server error" message if not provided', () => {
    const err = {} as AppError;

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR'
        })
      })
    );
  });
});
