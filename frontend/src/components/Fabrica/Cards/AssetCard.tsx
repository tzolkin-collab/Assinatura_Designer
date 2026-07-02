"use client";

import React from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import styles from './AssetCard.module.css';

interface AssetCardProps {
  name: string;
  sizeFormatted: string;
  dataUrl: string;
  onRemove: () => void;
}

export default function AssetCard({
  name,
  sizeFormatted,
  dataUrl,
  onRemove
}: AssetCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.thumb}>
        <Image
          src={dataUrl}
          alt={name}
          width={120}
          height={90}
          unoptimized
        />
      </div>
      <div className={styles.meta}>
        <div className={styles.name}>{name}</div>
        <div className={styles.info}>{sizeFormatted}</div>
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label="Remover imagem"
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}
