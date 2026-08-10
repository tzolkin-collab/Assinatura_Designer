import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { errorHandler, createError, AppError } from '../middleware/errorHandler';
import type { Request, Response, NextFunction } from 'express';

describe('createError', () => {
  it('should create an error with message and statusCode', () => {
    const error = createError(404, 'Not Found');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Not Found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBeUndefined();
  });

  it('should create an error with message, statusCode, and code', () => {
    const error = createError(400, 'Bad Request', 'INVALID_INPUT');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Bad Request');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_INPUT');
  });
});

describe('errorHandler middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('inclui stack trace na resposta quando NODE_ENV e development', () => {
    process.env.NODE_ENV = 'development';

    const err = new Error('Test error') as AppError;
    err.stack = 'Error stack trace details';

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Test error',
        code: 'INTERNAL_ERROR',
        stack: 'Error stack trace details',
      },
    });
  });

  // Igualdade exata de propósito: se `stack` vazar em producao, este teste quebra.
  it('nao inclui stack trace na resposta quando NODE_ENV e production', () => {
    process.env.NODE_ENV = 'production';

    const err = new Error('Production error') as AppError;
    err.stack = 'Sensitive stack trace';

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Production error',
        code: 'INTERNAL_ERROR',
      },
    });
  });

  it('usa statusCode, code e message do erro quando fornecidos', () => {
    const err = createError(400, 'Bad request', 'BAD_REQUEST');

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Bad request',
          code: 'BAD_REQUEST',
        }),
      })
    );
  });

  it('cai para 500 e "Internal server error" quando o erro vem vazio', () => {
    const err = {} as AppError;

    errorHandler(err, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      })
    );
  });
});
