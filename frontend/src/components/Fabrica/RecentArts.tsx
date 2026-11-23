'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useBrandPosts, type Post } from '@/lib/hooks';
import { extractPreviewSource, extractSessionId } from '@/lib/designContent';
import s from './RecentArts.module.css';

const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });

const QUANTAS = 6;

/** As artes prontas mais recentes, na ordem em que a Galeria já as entrega (mais nova primeiro). */
export function artesRecentes(posts: Post[], quantas = QUANTAS): Post[] {
  return posts
    .filter((p) => p.status !== 'FAILED' && p.status !== 'GENERATING')
    .filter((p) => extractPreviewSource(p.content, p.previewUrl) !== null)
    .slice(0, quantas);
}

/** Reabre a conversa que gerou a arte quando ela existe; senão, abre a arte no editor. */
export function destinoDaArte(marca: string, post: Post): string {
  const sessionId = extractSessionId(post.content);
  return sessionId
    ? `/${marca}/fabrica?sessionId=${encodeURIComponent(sessionId)}`
    : `/${marca}/editor/${post.id}`;
}

/**
 * Faixa das últimas artes da marca, abaixo da caixa de pedido quando a Fábrica está vazia.
 * Mostra como a marca já ficou antes de pedir a próxima peça. Sem artes, não aparece nada:
 * nenhum espaço vazio dizendo que não há nada.
 */
export function RecentArts({ marca, brandName }: { marca: string; brandName: string }) {
  const { posts, loading } = useBrandPosts(marca, { view: 'gallery' });
  const artes = artesRecentes(posts);
  if (loading || artes.length === 0) return null;

  return (
    <section className={s.root} aria-labelledby="fabrica-recentes">
      <div className={s.head}>
        <h2 id="fabrica-recentes" className={s.title}>Últimas de {brandName}</h2>
        <Link href={`/${marca}/galeria`} className={s.all}>Ver galeria</Link>
      </div>
      <ul className={s.grid}>
        {artes.map((post) => {
          const preview = extractPreviewSource(post.content, post.previewUrl);
          return (
            <li key={post.id}>
              <Link href={destinoDaArte(marca, post)} className={s.item}>
                <span className={s.frame}>
                  {preview?.kind === 'html-design' ? (
                    <HtmlSlideRenderer content={preview.content} mode="cover" hideNav />
                  ) : preview?.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview.url} alt="" className={s.img} loading="lazy" />
                  ) : null}
                </span>
                <span className={s.name}>{post.name || 'Sem nome'}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
