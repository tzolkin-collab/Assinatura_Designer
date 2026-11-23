'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Folder, FolderOpen } from 'lucide-react';
import type { Post } from '@/lib/hooks';
import { extractPreviewSource } from '@/lib/designContent';
import styles from '../brand-galeria.module.css';

const HtmlSlideRenderer = dynamic(() => import('@/components/DesignDocument/HtmlSlideRenderer'), { ssr: false });

interface FolderTileProps {
  name: string;
  /** Artes da pasta (e das subpastas), mais recentes primeiro; o quadro usa até 4. */
  capas: Post[];
  resumo: string;
  dragOver: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Capa de uma arte dentro do mosaico da pasta: imagem pronta ou o primeiro slide do deck. */
function Capa({ post }: { post: Post }) {
  const preview = extractPreviewSource(post.content, null);
  const imageUrl = post.previewUrl || (preview?.kind === 'image' ? preview.url : null);
  if (imageUrl) {
    return <Image src={imageUrl} alt="" fill className={styles.thumbImage} sizes="240px" unoptimized />;
  }
  if (preview?.kind === 'html-design') {
    return (
      <div className={styles.thumbDesign}>
        <HtmlSlideRenderer content={preview.content} mode="cover" hideNav />
      </div>
    );
  }
  return null;
}

/**
 * Pasta da galeria como um quadro com as capas do que está dentro. A fileira de pílulas que
 * existia antes só dizia o nome; daqui se vê de relance o que a pasta guarda, como no Canva,
 * no Figma e no Drive. Continua sendo alvo de arrasto de artes e de outras pastas.
 */
export function FolderTile({ name, capas, resumo, dragOver, draggable, onOpen, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }: FolderTileProps) {
  const n = Math.min(capas.length, 4);

  return (
    <button
      type="button"
      className={`${styles.folderTile} ${dragOver ? styles.folderTileDragOver : ''}`}
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label={`Abrir pasta ${name}, ${resumo.toLowerCase()}`}
    >
      <span className={styles.folderFrame} data-n={n}>
        {n === 0 ? (
          <span className={styles.folderEmpty}>
            {dragOver ? <FolderOpen size={22} aria-hidden="true" /> : <Folder size={22} aria-hidden="true" />}
            Arraste artes para cá
          </span>
        ) : (
          capas.slice(0, 4).map((post) => (
            <span key={post.id} className={styles.folderCover}>
              <Capa post={post} />
            </span>
          ))
        )}
      </span>
      <span className={styles.folderTileName}>
        <Folder size={16} aria-hidden="true" />
        <span className={styles.folderTileLabel}>{name}</span>
      </span>
      <span className={styles.folderTileMeta}>{resumo}</span>
    </button>
  );
}
