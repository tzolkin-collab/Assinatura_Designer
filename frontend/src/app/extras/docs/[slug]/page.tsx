'use client';

import React, { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft } from 'lucide-react';
import Card from '@/components/ui/Card';
import styles from './doc.module.css';
import { DOCS, getDocBySlug } from '../docsContent';

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function extractHeadings(markdown: string) {
  const lines = markdown.split('\n');
  const headings: { text: string; id: string; level: number }[] = [];
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    headings.push({ text, id: slugify(text), level });
  }
  return headings;
}

export default function DocDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  const toc = extractHeadings(doc.markdown);

  return (
    <div>
      <div className={styles.topActions}>
        <Link href="/extras/docs" className={styles.backLink}>
          <ArrowLeft size={16} />
          Voltar
        </Link>
      </div>

      <div className={styles.page}>
        <nav className={styles.nav}>
          <p className={styles.navTitle}>Documentação</p>
          <div className={styles.navList}>
            {DOCS.map((item) => {
              const active = item.slug === doc.slug;
              return (
                <Link
                  key={item.slug}
                  href={`/extras/docs/${item.slug}`}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                >
                  <span>{item.emoji ?? '📄'}</span>
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <Card padding="none" className={styles.contentCard}>
          <div className={styles.markdown}>
            <ReactMarkdown
              components={{
                h1: ({ children }) => <h1>{children}</h1>,
                h2: ({ children }) => {
                  const text = String(children);
                  const id = slugify(text);
                  return <h2 id={id}>{children}</h2>;
                },
                h3: ({ children }) => {
                  const text = String(children);
                  const id = slugify(text);
                  return <h3 id={id}>{children}</h3>;
                },
              }}
            >
              {doc.markdown}
            </ReactMarkdown>
          </div>
        </Card>

        <aside className={styles.toc}>
          <p className={styles.tocTitle}>Nesta Página</p>
          <div className={styles.tocList}>
            {toc.length === 0 ? (
              <span className={styles.tocLink}>Sem seções</span>
            ) : (
              toc.map((h) => (
                <a
                  key={h.id}
                  className={styles.tocLink}
                  href={`#${h.id}`}
                  style={{ paddingLeft: h.level === 3 ? 12 : 0 }}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(h.id);
                    if (el) {
                      const y = el.getBoundingClientRect().top + window.scrollY - 80;
                      window.scrollTo({ top: y, behavior: 'smooth' });
                    }
                  }}
                >
                  {h.text}
                </a>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
