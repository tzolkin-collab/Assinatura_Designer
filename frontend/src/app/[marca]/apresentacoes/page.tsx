'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PublishedPresentationsView from '@/components/PublishedPresentations/PublishedPresentationsView';
import { api, getApiErrorMessage } from '@/lib/api';
import { unpublishPost } from '@/lib/presentationHosting';
import type { PublishedPost } from '@/lib/publishedPresentations';

export default function ApresentacoesPublicadasPage() {
  const params = useParams();
  const slug = params.marca as string;

  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let vivo = true;
    api.get<PublishedPost[]>(`/brands/${slug}/posts?published=true`)
      .then((data) => { if (vivo) { setPosts(data ?? []); setError(''); } })
      .catch((err) => { if (vivo) setError(getApiErrorMessage(err, 'Não foi possível carregar as apresentações publicadas.')); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [slug, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError('');
    setReloadKey((n) => n + 1);
  };

  const unpublish = async (post: PublishedPost) => {
    try {
      await unpublishPost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setError('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Não foi possível despublicar.'));
      throw err; // o diálogo fecha e o aviso fica visível no topo
    }
  };

  return (
    <PublishedPresentationsView
      slug={slug}
      posts={posts}
      loading={loading}
      error={error}
      // Só é lido depois de carregar (no servidor a tela está em "carregando"), então não há divergência de hidratação.
      origin={typeof window !== 'undefined' ? window.location.origin : ''}
      onRetry={retry}
      onUnpublish={unpublish}
    />
  );
}
