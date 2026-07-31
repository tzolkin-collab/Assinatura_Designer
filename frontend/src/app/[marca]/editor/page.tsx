'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenTool } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { extractEditablePages } from '@/lib/designContent';
import { useBrandPosts } from '@/lib/hooks';
import styles from './editor-index.module.css';

export default function EditorIndexPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.marca as string;
  const { posts, loading } = useBrandPosts(slug);

  const designPosts = posts.filter((p) => extractEditablePages(p.content).status === 'html');

  useEffect(() => {
    if (loading || designPosts.length === 0) return;

    const lastPostId = localStorage.getItem(`editor_last_post_${slug}`);
    
    // Se o último post aberto ainda existe na lista, abre ele
    if (lastPostId && designPosts.some(p => p.id === lastPostId)) {
      router.replace(`/${slug}/editor/${lastPostId}`);
      return;
    }
    
    // Senão, abre o mais recente
    router.replace(`/${slug}/editor/${designPosts[0].id}`);
  }, [loading, designPosts, slug, router]);

  return (
    <div>
      <Link href={`/${slug}/galeria`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', textDecoration: 'none', marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={14} />
        Voltar
      </Link>

      <PageHeader
        title="Editor"
        description="Selecione um design para editar camadas, posições e textos."
      />

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Carregando designs...</p>
      ) : designPosts.length === 0 ? (
        <div className={styles.empty}>
          <PenTool size={36} className={styles.emptyIcon} />
          <p>Nenhum design disponível para editar.</p>
          <p style={{ fontSize: 13 }}>Gere apresentações na Fábrica para editá-las aqui.</p>
        </div>
      ) : (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Abrindo última apresentação...</p>
      )}
    </div>
  );
}
