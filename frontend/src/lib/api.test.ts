import { describe, it, expect } from 'vitest';
import { isForbidden, getApiErrorMessage, ApiError } from './api';

describe('api.ts tests', () => {
  describe('isForbidden', () => {
    it('returns true for ApiError with status 403', () => {
      const error = new ApiError(403, 'Forbidden');
      expect(isForbidden(error)).toBe(true);
    });

    it('returns false for ApiError with other status codes', () => {
      const error = new ApiError(401, 'Unauthorized');
      expect(isForbidden(error)).toBe(false);

      const error500 = new ApiError(500, 'Server Error');
      expect(isForbidden(error500)).toBe(false);
    });

    it('returns false and does not crash for standard Error objects', () => {
      const error = new Error('Standard error');
      expect(isForbidden(error)).toBe(false);
    });

    it('returns false and does not crash for null or undefined', () => {
      expect(isForbidden(null)).toBe(false);
      expect(isForbidden(undefined)).toBe(false);
    });

    it('returns false and does not crash for arbitrary objects without status 403', () => {
      const obj = { status: 500, message: 'Server Error' };
      expect(isForbidden(obj)).toBe(false);
    });

    it('returns false for primitive values', () => {
      expect(isForbidden(403)).toBe(false);
      expect(isForbidden('403')).toBe(false);
      expect(isForbidden(true)).toBe(false);
    });
  });

  describe('getApiErrorMessage', () => {
    it('returns error message for ApiError with status 403 and a message', () => {
      const error = new ApiError(403, 'Custom forbidden message');
      expect(getApiErrorMessage(error)).toBe('Custom forbidden message');
    });

    it('returns fallback permission message for ApiError with status 403 and empty message', () => {
      const error = new ApiError(403, '');
      expect(getApiErrorMessage(error)).toBe('Você não tem permissão para realizar esta ação.');
    });

    it('returns error message for ApiError with non-403 status', () => {
      const error = new ApiError(400, 'Bad Request');
      expect(getApiErrorMessage(error)).toBe('Bad Request');
    });

    it('returns fallback for ApiError with non-403 status and no message', () => {
      const error = new ApiError(500, '');
      expect(getApiErrorMessage(error)).toBe('Algo deu errado.');
      expect(getApiErrorMessage(error, 'Custom fallback')).toBe('Custom fallback');
    });

    it('returns error message for standard Error with a message', () => {
      const error = new Error('Standard error message');
      expect(getApiErrorMessage(error)).toBe('Standard error message');
    });

    it('returns fallback for standard Error with no message', () => {
      const error = new Error('');
      expect(getApiErrorMessage(error)).toBe('Algo deu errado.');
    });

    it('returns fallback for null, undefined, or arbitrary objects', () => {
      expect(getApiErrorMessage(null)).toBe('Algo deu errado.');
      expect(getApiErrorMessage(undefined)).toBe('Algo deu errado.');
      expect(getApiErrorMessage({ status: 403 })).toBe('Algo deu errado.');
      expect(getApiErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    });
  });
});
