'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';

export interface BrandAsset {
  id: string;
  name: string;
  url: string;
  fileType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
}

/**
 * Biblioteca de mídia da marca.
 *
 * O upload vai para /brands/:slug/assets — a biblioteca de verdade, que grava uma
 * linha em `Asset` e devolve uma URL permanente do R2. NÃO usar /upload aqui: aquela
 * rota é genérica, joga o arquivo num balde solto e o asset não fica reutilizável.
 */
export function useBrandAssets(slug: string) {
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await api.get<BrandAsset[]>(`/brands/${slug}/assets`);
      setAssets(data ?? []);
      setError('');
    } catch (e) {
      setError(getApiErrorMessage(e, 'Não foi possível carregar a biblioteca.'));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File): Promise<BrandAsset | null> => {
      setUploading(true);
      setError('');
      try {
        const asset = await api.uploadFile<BrandAsset>(`/brands/${slug}/assets`, file);
        await refresh();
        return asset;
      } catch (e) {
        setError(getApiErrorMessage(e, 'Falha ao enviar o arquivo.'));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [slug, refresh],
  );

  return { assets, loading, uploading, error, upload, refresh };
}
