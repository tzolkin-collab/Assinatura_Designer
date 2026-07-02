import React from 'react';
import { Copy, Trash2, Plus, ArrowUp, ArrowDown } from 'lucide-react';
import DesignRenderer, { type DesignPage } from '@/components/Fabrica/DesignRenderer';
import styles from './SlideThumbnailPanel.module.css';

interface SlideThumbnailPanelProps {
  pages: DesignPage[];
  activeSlide: number;
  canvasW: number;
  canvasH: number;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (index: number) => void;
  onDeleteSlide: (index: number) => void;
  onReorderSlide: (from: number, to: number) => void;
}

export default function SlideThumbnailPanel({
  pages,
  activeSlide,
  canvasW,
  canvasH,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onReorderSlide
}: SlideThumbnailPanelProps) {
  if (pages.length === 0) return null;
  const atLimit = pages.length >= 20;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>Slides</div>
      
      <div className={styles.slideList}>
        {pages.map((page, index) => {
          const isActive = index === activeSlide;
          
          return (
            <div key={index} className={styles.slideWrapper}>
              <div className={styles.slideLabel}>
                <span className={styles.slideNumber}>{index + 1}</span>
                
                <div className={styles.slideActions}>
                  <button 
                    className={styles.actionBtn} 
                    onClick={() => onReorderSlide(index, index - 1)}
                    disabled={index === 0}
                    title="Mover para cima"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button 
                    className={styles.actionBtn} 
                    onClick={() => onReorderSlide(index, index + 1)}
                    disabled={index === pages.length - 1}
                    title="Mover para baixo"
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button 
                    className={styles.actionBtn} 
                    onClick={() => onDuplicateSlide(index)}
                    disabled={atLimit}
                    title={atLimit ? 'Limite de 20 slides' : 'Duplicar slide'}
                  >
                    <Copy size={11} />
                  </button>
                  <button 
                    className={styles.actionBtn} 
                    onClick={() => onDeleteSlide(index)}
                    disabled={pages.length <= 1}
                    title="Deletar slide"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              
              <button 
                className={`${styles.thumbnailBtn} ${isActive ? styles.thumbnailActive : ''}`}
                onClick={() => onSelectSlide(index)}
                style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
              >
                <div className={styles.thumbnailCanvas}>
                  <DesignRenderer
                    pages={[page]}
                    canvasWidth={canvasW}
                    canvasHeight={canvasH}
                    hideNav
                  />
                </div>
              </button>
            </div>
          );
        })}
        
        <button
          className={styles.addBtn}
          onClick={onAddSlide}
          disabled={atLimit}
          title={atLimit ? 'Limite de 20 slides atingido' : 'Adicionar slide em branco'}
        >
          <Plus size={14} />
          {atLimit ? 'Limite (20)' : 'Novo Slide'}
        </button>
      </div>
    </div>
  );
}
