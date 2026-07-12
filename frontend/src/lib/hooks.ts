// designer/frontend/src/lib/hooks.ts
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type Brand = {
  id: string;
  slug: string;
  name?: string;
} & Record<string, unknown>;

export type BrandConfig = Record<string, unknown>;

export type Post = {
  id: string;
  type: string;
  status?: string;
  content?: unknown;
  previewUrl?: string | null;
  folderId?: string | null;
  createdAt: string;
  updatedAt?: string;
  brandId?: string;
};

export type UserConnection = {
  asana: boolean;
  drive: boolean;
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  connections?: UserConnection;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) {
      const id = requestAnimationFrame(() => setLoading(false));
      return () => cancelAnimationFrame(id);
    }

    api.get<User>('/auth/me')
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('auth_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, setUser };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Erro inesperado';
}

export function useBrands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Brand[]>('/brands')
      .then(setBrands)
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return { brands, loading, error };
}

export function useBrand(slug: string) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    api.get<Brand>(`/brands/${slug}`)
      .then(setBrand)
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  return { brand, loading, error };
}

export function useConfig(slug: string) {
  const [config, setConfig] = useState<BrandConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    api.get<BrandConfig>(`/settings/${slug}/config`)
      .then(setConfig)
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  return { config, loading, error };
}

export function useBrandPosts(slug: string) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPosts = useCallback(() => {
    if (!slug) { setLoading(false); return; }
    setLoading(true);
    api.get<Post[]>(`/brands/${slug}/posts`)
      .then(setPosts)
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    const id = requestAnimationFrame(fetchPosts);
    return () => cancelAnimationFrame(id);
  }, [fetchPosts]);

  // Auto-refresh enquanto algum post estiver GENERATING (ex.: recém-criado na
  // Fábrica) — antes só aparecia como READY após reload manual. Faz um fetch
  // silencioso (sem mexer em loading/error) e para quando nenhum está gerando.
  const hasGenerating = posts.some((p) => p.status === 'GENERATING');
  useEffect(() => {
    if (!slug || !hasGenerating) return;
    const interval = setInterval(() => {
      api.get<Post[]>(`/brands/${slug}/posts`).then(setPosts).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [slug, hasGenerating]);

  return { posts, loading, error, mutate: fetchPosts };
}
