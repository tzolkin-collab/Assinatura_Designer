'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, ExternalLink, Copy, Globe } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import styles from './apresentacoes.module.css';
import { api, getApiErrorMessage } from '@/lib/api';
import { unpublishPost } from '@/lib/presentationHosting';

interface PublishedPost {
  id: string;
  name: string | null;
  type: 'CAROUSEL' | 'SINGLE_IMAGE' | 'PRESENTATION';
  publicSlug: string;
  publishedAt: string;
  updatedAt: string;
}

const TYPE_LABELS: Record<PublishedPost['type'], string> = {
  PRESENTATION: 'Apresentação',
  CAROUSEL: 'Carrossel',
  SINGLE_IMAGE: 'Design',
};

export default function ApresentacoesPublicadasPage() {
  const params = useParams();
  const slug = params.marca as string;

  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appOrigin, setAppOrigin] = useState('');

  useEffect(() => {
    setAppOrigin(window.location.origin);
  }, []);

  const fetchPosts = useCallback(() => {
    api.get<PublishedPost[]>(`/brands/${slug}/posts?published=true`)
      .then((data) => setPosts(data ?? []))
      .catch((err) => setError(getApiErrorMessage(err, 'Não foi possível carregar as apresentações publicadas.')))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const publicUrl = (publicSlug: string) => `${appOrigin}/apresentacao/${publicSlug}`;

  const handleCopy = (post: PublishedPost) => {
    navigator.clipboard?.writeText(publicUrl(post.publicSlug)).then(() => {
      setCopiedId(post.id);
      setTimeout(() => setCopiedId((id) => (id === post.id ? null : id)), 1500);
    });
  };

  const handleUnpublish = async (post: PublishedPost) => {
    if (!window.confirm(`Despublicar "${post.name || 'esta apresentação'}"? O link público atual para de funcionar.`)) return;
    setUnpublishingId(post.id);
    try {
      await unpublishPost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Não foi possível despublicar.'));
    } finally {
      setUnpublishingId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <PageHeader
          title="Apresentações Publicadas"
          description="Apresentações hospedadas como página pública — qualquer pessoa com o link acessa, sem login."
        />
      </div>

      {error && <p className={styles.errorText} role="alert">{error}</p>}

      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 className="animate-spin" size={16} />
          Carregando apresentações publicadas...
        </div>
      ) : posts.length === 0 ? (
        <p className={styles.empty}>
          Nenhuma apresentação publicada ainda. Abra uma apresentação na Fábrica e use o botão &quot;Hospedar&quot; no painel do artefato pra gerar um link público.
        </p>
      ) : (
        <Card padding="none">
          <div className={styles.tableHeader}>
            <div>Nome</div>
            <div>Publicada em</div>
            <div>Link público</div>
            <div></div>
          </div>
          <div className={styles.list}>
            {posts.map((post) => (
              <div key={post.id} className={styles.row}>
                <div className={styles.nameCell}>
                  <span className={styles.name}>{post.name || 'Sem nome'}</span>
                  <span className={styles.typeBadge}>{TYPE_LABELS[post.type]}</span>
                </div>
                <div className={styles.dateCell}>
                  {new Date(post.publishedAt).toLocaleDateString('pt-BR')}
                </div>
                <div className={styles.linkCell}>
                  <a
                    href={publicUrl(post.publicSlug)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.linkText}
                    title={publicUrl(post.publicSlug)}
                  >
                    {publicUrl(post.publicSlug)}
                  </a>
                  <button className={styles.iconButton} onClick={() => handleCopy(post)} title="Copiar link">
                    <Copy size={14} />
                  </button>
                  {copiedId === post.id && <span className={styles.typeBadge}>Copiado!</span>}
                  <a
                    href={publicUrl(post.publicSlug)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.iconButton}
                    title="Abrir em nova aba"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.unpublishButton}
                    disabled={unpublishingId === post.id}
                    onClick={() => handleUnpublish(post)}
                  >
                    {unpublishingId === post.id ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                    Despublicar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
