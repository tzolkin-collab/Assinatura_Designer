'use client';

import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import styles from './docs.module.css';
import { DOCS } from './docsContent';

export default function DocsPage() {
  return (
    <div>
      <PageHeader
        title="Documentação"
        description="Guia de uso e referências do Design Studio."
      />

      <div className={styles.grid}>
        {DOCS.map((doc) => (
          <Link key={doc.slug} href={`/extras/docs/${doc.slug}`} className={styles.cardLink}>
            <Card padding="lg" hover className={styles.docCard}>
              <h3 className={styles.cardTitle}>{doc.emoji ? `${doc.emoji} ` : ''}{doc.title}</h3>
              <p className={styles.cardDesc}>
                {doc.description}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
