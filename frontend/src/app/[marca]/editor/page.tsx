'use client';

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
            const slideCount = editable.status === 'html' ? editable.content.slides.length : 0;
            return (
              <button
                key={post.id}
                className={styles.card}
                onClick={() => router.push(`/${slug}/editor/${post.id}`)}
              >
                <div className={styles.thumb} style={{ backgroundColor: '#1a1a1a' }}>
                  {post.previewUrl ? (
                    <img src={post.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 12 }}>
                      Sem Preview
                    </div>
                  )}
                </div>
                <div className={styles.meta}>
                  <span className={styles.metaId}>{post.id.split('-')[0]}…</span>
                  <span className={styles.metaSlides}>{slideCount} slides</span>
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
