// designer/frontend/src/lib/hooks.ts
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type Brand = {
  id: string;
  slug: string;
  name?: string;
  myRole?: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  members?: Array<{ role: string; user: { id: string; name: string; email: string } }>;
} & Record<string, unknown>;

export type BrandConfig = Record<string, unknown>;

export type Post = {
  id: string;
  name: string | null;
  type: string;
  status?: string;
  content?: unknown;
  previewUrl?: string | null;
  folderId?: string | null;
  createdAt: string;
  updatedAt?: string;
  brandId?: string;
  createdBy?: { id: string; name: string; email: string } | null;
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

// ── Gasto de IA (transparência + billing) ─────────────────────────────────────
export type Currency = 'USD' | 'BRL';

export type AiCost = {
  currency: Currency;
  base: number; // gasto estimado
  tax: number;  // imposto, separado
  total: number;
};

export type ModelUsageRow = {
  model: string;
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  cost: AiCost;
};

export type AiUsage = {
  day: string;
  globalTokens: number;
  globalBudget: number;
  brandSlug?: string;
  brandTokens?: number;
  brandBudget: number;
  models: ModelUsageRow[];
  cost: AiCost;
  currency: Currency;
  taxRate: number;
};

export type AiBilling = {
  brandSlug?: string;
  month: string;
  availableMonths: string[];
  models: ModelUsageRow[];
  totals: {
    calls: number;
    promptTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    cost: AiCost;
  };
  currency: Currency;
  taxRate: number;
  prices: Record<string, { input: number; output: number }>;
};

/** Consumo de IA de HOJE desta marca — para o widget de transparência. */
export function useAiUsage(slug: string) {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsage = useCallback(() => {
    if (!slug) { setLoading(false); return; }
    setLoading(true);
    api.get<AiUsage>(`/brands/${slug}/ai-usage`)
      .then(setUsage)
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  // rAF adia o setState para fora do corpo do efeito (evita cascading renders) — mesmo
  // padrão de useBrandPosts.
  useEffect(() => {
    const id = requestAnimationFrame(fetchUsage);
    return () => cancelAnimationFrame(id);
  }, [fetchUsage]);

  return { usage, loading, error, refresh: fetchUsage };
}

/** Billing mensal por modelo desta marca. `month` no formato YYYY-MM (default: mês atual). */
export function useAiBilling(slug: string, month?: string) {
  const [billing, setBilling] = useState<AiBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!slug) { setLoading(false); return; }
      setLoading(true);
      const qs = month ? `?month=${encodeURIComponent(month)}` : '';
      api.get<AiBilling>(`/brands/${slug}/ai-usage/billing${qs}`)
        .then(setBilling)
        .catch((err: unknown) => setError(getErrorMessage(err)))
        .finally(() => setLoading(false));
    });
    return () => cancelAnimationFrame(id);
  }, [slug, month]);

  return { billing, loading, error };
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
