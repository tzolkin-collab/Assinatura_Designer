'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenTool } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DesignRenderer from '@/components/Fabrica/DesignRenderer';
import { extractEditablePages } from '@/lib/designContent';
import { useBrandPosts } from '@/lib/hooks';
import styles from './editor-index.module.css';

export default function EditorIndexPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.marca as string;
  const { posts, loading } = useBrandPosts(slug);

  const designPosts = posts.filter((p) => extractEditablePages(p.content).status === 'editable');

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
        <div className={styles.grid}>
          {designPosts.map(post => {
            const editable = extractEditablePages(post.content);
            const dp = editable.status === 'editable' ? editable.pages : [];
            const first = dp[0];
            return (
              <button
                key={post.id}
                className={styles.card}
                onClick={() => router.push(`/${slug}/editor/${post.id}`)}
              >
                <div
                  className={styles.thumb}
                  style={{ backgroundColor: first?.backgroundColor ?? '#111' }}
                >
                  {first && (
                    <DesignRenderer
                      pages={[first]}
                      canvasWidth={first.width ?? 1080}
                      canvasHeight={first.height ?? 1080}
                      hideNav
                      mode="cover"
                    />
                  )}
                </div>
                <div className={styles.meta}>
                  <span className={styles.metaId}>{post.id.split('-')[0]}…</span>
                  <span className={styles.metaSlides}>{dp.length} slides</span>
                  <span className={styles.metaDate}>{new Date(post.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
