'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchPublicPresentation, type PublicPresentation } from '@/lib/presentationHosting';
import { getApiErrorMessage } from '@/lib/api';
import type { HtmlDesignPostContent } from '@/lib/designContent';
import PresentationViewer from '@/components/PresentationViewer/PresentationViewer';
import styles from './apresentacao.module.css';

export default function ApresentacaoPublicaPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [data, setData] = useState<PublicPresentation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublicPresentation(slug)
      .then(setData)
      .catch((e: unknown) => setError(getApiErrorMessage(e, 'Esta apresentação não está disponível.')))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div className={styles.status}>Carregando…</div>;
  }

  if (error || !data || !data.content) {
    return (
      <div className={styles.status}>
        <p>{error || 'Apresentação não encontrada.'}</p>
      </div>
    );
  }

  return (
    <PresentationViewer
      slug={slug}
      name={data.name}
      content={data.content as HtmlDesignPostContent}
      hostingConfig={data.hostingConfig}
      isOwner={data.isOwner}
      postId={data.postId}
      chatEnabledInitial={data.chat.enabled}
    />
  );
}
