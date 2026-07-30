import { describe, it, expect } from 'vitest';
import { createError, AppError } from '../middleware/errorHandler';

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
