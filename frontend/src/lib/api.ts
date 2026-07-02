// designer/frontend/src/lib/api.ts

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface FetchOptions extends RequestInit {
  requireAuth?: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, public message: string, public code?: string) {
    super(message);
  }
}

async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { requireAuth = true, headers, ...customOptions } = options;
  
  const headersConfig: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  if (requireAuth) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      headersConfig['Authorization'] = `Bearer ${token}`;
    } else if (typeof window !== 'undefined') {
      window.location.href = '/login';
      throw new ApiError(401, 'Missing token, redirecting to login');
    }
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: headersConfig,
    ...customOptions,
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('auth_token');
    document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error?.message || response.statusText,
      data?.error?.code
    );
  }

  return data.data; // Our backend always wraps content in { data: ... }
}

export const api = {
  get: <T>(endpoint: string, options?: FetchOptions) => apiFetch<T>(endpoint, { ...options, method: 'GET' }),
  post: <T, B = unknown>(endpoint: string, body: B, options?: FetchOptions) => apiFetch<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: <T, B = unknown>(endpoint: string, body: B, options?: FetchOptions) => apiFetch<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string, options?: FetchOptions) => apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
  uploadFile: async <T>(endpoint: string, file: File, options: FetchOptions = {}): Promise<T> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const { requireAuth = true, headers, ...customOptions } = options;
    const headersConfig: Record<string, string> = {
      ...(headers as Record<string, string>),
    };
    // Let the browser set Content-Type for FormData (with boundary)

    if (requireAuth) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      if (token) headersConfig['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      body: formData,
      headers: headersConfig,
      ...customOptions,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, data?.error?.message || response.statusText, data?.error?.code);
    }
    return data.data;
  }
};
