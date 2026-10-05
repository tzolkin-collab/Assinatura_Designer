'use client';

import { useEffect, useRef, useState } from 'react';
import { Images, MonitorPlay, Image as ImageIcon } from 'lucide-react';
import type { PublishedCover, PublishedType } from '@/lib/publishedPresentations';
import styles from './PublishedPresentations.module.css';

const TYPE_ICON = { PRESENTATION: MonitorPlay, CAROUSEL: Images, SINGLE_IMAGE: ImageIcon } as const;

interface CoverFrameProps {
  cover: PublishedCover | null;
  type: PublishedType;
}

/**
 * A capa é o primeiro slide, exibido em escala reduzida dentro de um iframe ISOLADO
 * (`sandbox` vazio: sem script, sem acesso à página). O documento já foi sanitizado ao ser
 * gravado; o isolamento é a segunda camada. A escala acompanha a largura do cartão.
 */
export default function CoverFrame({ cover, type }: CoverFrameProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !cover) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / cover.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cover]);

  if (!cover) {
    const Icon = TYPE_ICON[type];
    return (
      <div className={`${styles.frame} ${styles.framePlaceholder}`} style={{ aspectRatio: '16 / 9' }}>
        <Icon size={28} aria-hidden="true" />
        <span>Sem pré-visualização</span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={styles.frame} style={{ aspectRatio: `${cover.width} / ${cover.height}` }}>
      <iframe
        sandbox=""
        srcDoc={cover.html}
        title="Capa da apresentação"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        className={styles.coverIframe}
        style={{
          width: cover.width,
          height: cover.height,
          transform: `scale(${scale})`,
          // Antes de medir o cartão, a capa ficaria gigante por um instante.
          opacity: scale > 0 ? 1 : 0,
        }}
      />
    </div>
  );
}
