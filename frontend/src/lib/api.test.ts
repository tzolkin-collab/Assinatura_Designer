import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, isForbidden, getApiErrorMessage, API_BASE } from './api';

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('ApiError', () => {
    it('creates an ApiError with status, message and optional code', () => {
      const err = new ApiError(404, 'Not Found', 'ERR_NOT_FOUND');
      expect(err.status).toBe(404);
      expect(err.message).toBe('Not Found');
      expect(err.code).toBe('ERR_NOT_FOUND');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('isForbidden', () => {
    it('returns true for ApiError with status 403', () => {
      const err = new ApiError(403, 'Forbidden');
      expect(isForbidden(err)).toBe(true);
    });

    it('returns false for ApiError with other status', () => {
      const err = new ApiError(404, 'Not Found');
      expect(isForbidden(err)).toBe(false);
    });

    it('returns false for generic errors', () => {
      const err = new Error('Forbidden');
      expect(isForbidden(err)).toBe(false);
    });
  });

  describe('getApiErrorMessage', () => {
    it('handles 403 ApiError', () => {
      const err = new ApiError(403, 'You do not have permission.');
      expect(getApiErrorMessage(err)).toBe('You do not have permission.');
    });

    it('handles 403 ApiError without message', () => {
      const err = new ApiError(403, '');
      expect(getApiErrorMessage(err)).toBe('Você não tem permissão para realizar esta ação.');
    });

    it('handles other ApiErrors', () => {
      const err = new ApiError(404, 'Resource not found.');
      expect(getApiErrorMessage(err)).toBe('Resource not found.');
    });

    it('handles generic Errors', () => {
      const err = new Error('Some generic error');
      expect(getApiErrorMessage(err)).toBe('Some generic error');
    });

    it('returns fallback for unknown errors', () => {
      expect(getApiErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
      expect(getApiErrorMessage(null)).toBe('Algo deu errado.');
    });
  });

  describe('fetch wrappers', () => {
    let mockFetch: any;

    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    describe('network errors', () => {
      it('throws an actionable ApiError when fetch throws (network failure)', async () => {
        mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(api.get('/test', { requireAuth: false })).rejects.toThrow(
          'Não consegui falar com o servidor. Ele pode estar reiniciando — espere alguns segundos e tente de novo.'
        );

        try {
          await api.get('/test', { requireAuth: false });
        } catch (err: any) {
          expect(err.status).toBe(0);
          expect(err.code).toBe('NETWORK');
        }
      });
    });

    describe('successful responses', () => {
      it('returns unwrapped data if response is OK and has data field', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: { id: 1, name: 'Test' } })
        });

        const result = await api.get('/test', { requireAuth: false });
        expect(result).toEqual({ id: 1, name: 'Test' });
        expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/test`, expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }));
      });

      it('returns full data if response is OK but no data field', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, name: 'Test' })
        });

        const result = await api.get('/test', { requireAuth: false });
        expect(result).toEqual({ id: 1, name: 'Test' });
      });

      it('returns empty array for 304 response', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 304,
        });

        const result = await api.get('/test', { requireAuth: false });
        expect(result).toEqual([]);
      });
    });

    describe('error responses', () => {
      it('throws ApiError with correct status and message from response body', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ error: { message: 'Invalid field', code: 'INVALID_FIELD' } })
        });

        await expect(api.get('/test', { requireAuth: false })).rejects.toThrow('Invalid field');

        try {
          await api.get('/test', { requireAuth: false });
        } catch (err: any) {
          expect(err.status).toBe(400);
          expect(err.code).toBe('INVALID_FIELD');
        }
      });

      it('falls back to statusText if error message is not in body', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => null // simulate empty or unparseable json
        });

        await expect(api.get('/test', { requireAuth: false })).rejects.toThrow('Internal Server Error');
      });
    });

    describe('HTTP methods', () => {
      beforeEach(() => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        });
      });

      it('api.post sends body as JSON string', async () => {
        await api.post('/test', { foo: 'bar' }, { requireAuth: false });
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ foo: 'bar' })
        }));
      });

      it('api.put sends body as JSON string', async () => {
        await api.put('/test', { foo: 'bar' }, { requireAuth: false });
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ foo: 'bar' })
        }));
      });

      it('api.patch sends body as JSON string if present', async () => {
        await api.patch('/test', { foo: 'bar' }, { requireAuth: false });
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ foo: 'bar' })
        }));
      });

      it('api.delete uses DELETE method', async () => {
        await api.delete('/test', { requireAuth: false });
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          method: 'DELETE'
        }));
      });
    });
  });

  describe('auth and tokens', () => {
    let mockFetch: any;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      });
      vi.stubGlobal('fetch', mockFetch);

      // Mock window and localStorage
      const localStorageMock = (() => {
        let store: Record<string, string> = {};
        return {
          getItem: (key: string) => store[key] || null,
          setItem: (key: string, value: string) => {
            store[key] = value.toString();
          },
          removeItem: (key: string) => {
            delete store[key];
          },
          clear: () => {
            store = {};
          }
        };
      })();

      vi.stubGlobal('window', {
        location: { href: '' }
      });
      vi.stubGlobal('localStorage', localStorageMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('adds Authorization header if token exists', async () => {
      localStorage.setItem('auth_token', 'my-secret-token');
      await api.get('/test'); // requireAuth is true by default

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-secret-token'
        })
      }));
    });

    it('redirects to /login if requireAuth is true and token is missing', async () => {
      await expect(api.get('/test')).rejects.toThrow('Missing token, redirecting to login');
      expect(window.location.href).toBe('/login');
    });

    it('does not redirect if requireAuth is optional and token is missing', async () => {
      await api.get('/test', { requireAuth: 'optional' });
      expect(window.location.href).not.toBe('/login');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('does not send Authorization header if requireAuth is false even if token exists', async () => {
      localStorage.setItem('auth_token', 'my-secret-token');
      await api.get('/test', { requireAuth: false });

      const args = mockFetch.mock.calls[0][1];
      expect(args.headers.Authorization).toBeUndefined();
    });
  });

  describe('uploadFile', () => {
    let mockFetch: any;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { url: 'https://example.com/file.png' } })
      });
      vi.stubGlobal('fetch', mockFetch);

      // We need to mock File and FormData as they might not be available in node env depending on vitest setup
      if (typeof global.File === 'undefined') {
        global.File = class File {
          name: string;
          constructor(parts: any[], name: string, options?: any) {
            this.name = name;
          }
        } as any;
      }

      if (typeof global.FormData === 'undefined') {
        global.FormData = class FormData {
          data = new Map();
          append(key: string, value: any) {
            this.data.set(key, value);
          }
        } as any;
      }
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uploads file using FormData and omits Content-Type header', async () => {
      const mockFile = new File([''], 'test.png', { type: 'image/png' });
      const result = await api.uploadFile('/upload', mockFile, { requireAuth: false });

      expect(result).toEqual({ url: 'https://example.com/file.png' });

      const args = mockFetch.mock.calls[0][1];
      expect(args.method).toBe('POST');
      expect(args.body).toBeInstanceOf(FormData);
      expect(args.headers['Content-Type']).toBeUndefined();
    });
  });

  describe('401 handling during fetch', () => {
    let mockFetch: any;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Unauthorized' } })
      });
      vi.stubGlobal('fetch', mockFetch);

      const localStorageMock = (() => {
        let store: Record<string, string> = { auth_token: 'invalid-token' };
        return {
          getItem: (key: string) => store[key] || null,
          setItem: (key: string, value: string) => {
            store[key] = value.toString();
          },
          removeItem: (key: string) => {
            delete store[key];
          },
          clear: () => {
            store = {};
          }
        };
      })();

      vi.stubGlobal('window', {
        location: { href: '' }
      });
      vi.stubGlobal('document', {
        cookie: ''
      });
      vi.stubGlobal('localStorage', localStorageMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('clears token and redirects on 401 response if requireAuth is true', async () => {
      await expect(api.get('/protected-route')).rejects.toThrow('Unauthorized');

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(document.cookie).toContain('auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(window.location.href).toBe('/login');
    });
  });

  describe('uploadFile error handling', () => {
    let mockFetch: any;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
        json: async () => ({ error: { message: 'File too large', code: 'FILE_TOO_LARGE' } })
      });
      vi.stubGlobal('fetch', mockFetch);

      if (typeof global.File === 'undefined') {
        global.File = class File {
          name: string;
          constructor(parts: any[], name: string, options?: any) {
            this.name = name;
          }
        } as any;
      }

      if (typeof global.FormData === 'undefined') {
        global.FormData = class FormData {
          data = new Map();
          append(key: string, value: any) {
            this.data.set(key, value);
          }
        } as any;
      }
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('throws ApiError on failed upload', async () => {
      const mockFile = new File([''], 'test.png', { type: 'image/png' });

      await expect(api.uploadFile('/upload', mockFile, { requireAuth: false })).rejects.toThrow('File too large');

      try {
        await api.uploadFile('/upload', mockFile, { requireAuth: false });
      } catch (err: any) {
        expect(err.status).toBe(413);
        expect(err.code).toBe('FILE_TOO_LARGE');
      }
    });
  });
});
