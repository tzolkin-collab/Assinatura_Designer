'use client';

import { useState } from 'react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Eye, EyeOff, Lock, Unlock, Type, Image as ImageIcon, Square, Pencil } from 'lucide-react';
import styles from './LayerListPanel.module.css';

interface Props {
  layers: Layer[];
  selectedLayerIds: string[];
  onSelect: (id: string, multi: boolean) => void;
  onChange: (id: string, overrides: Partial<Layer>) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function getLayerLabel(layer: Layer): string {
  if (layer.name) return layer.name;
  if (layer.type === 'text') return layer.content ? layer.content.substring(0, 20) : 'Texto';
  if (layer.type === 'image') return 'Imagem';
  return 'Forma';
}

function getLayerIcon(layer: Layer) {
  if (layer.type === 'text') return <Type size={13} />;
  if (layer.type === 'image') return <ImageIcon size={13} />;
  return <Square size={13} />;
}

export default function LayerListPanel({ layers, selectedLayerIds, onSelect, onChange, onReorder }: Props) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Note: Layers in this panel should usually be displayed top-to-bottom = highest zIndex to lowest.
  // The 'layers' prop might be in any order, so we sort it here (descending zIndex).
  const sortedLayers = [...layers].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (dropIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === dropIdx) {
      setDraggedIdx(null);
      return;
    }
    
    // We have sortedLayers, which is descending z-index.
    // The visual `draggedIdx` and `dropIdx` represent their position in this reversed array.
    // To reorder, we can just assign new zIndex values based on the new visual order.
    
    const newOrder = [...sortedLayers];
    const [moved] = newOrder.splice(draggedIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    
    // Re-assign z-indexes from length down to 1
    newOrder.forEach((layer, i) => {
      onChange(layer.id, { zIndex: newOrder.length - i });
    });

    setDraggedIdx(null);
  };

  if (layers.length === 0) {
    return <div className={styles.empty}>Sem camadas neste slide.</div>;
  }

  return (
    <div className={styles.container}>
      {sortedLayers.map((layer, idx) => {
        const isSelected = selectedLayerIds.includes(layer.id);
        const isVisible = layer.visible !== false;
        const isLocked = layer.locked === true;
        
        return (
          <div
            key={layer.id}
            draggable
            onDragStart={(e) => handleDragStart(idx, e)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(idx, e)}
            onClick={(e) => onSelect(layer.id, e.ctrlKey || e.metaKey)}
            className={`${styles.item} ${isSelected ? styles.selected : ''} ${!isVisible ? styles.hidden : ''}`}
          >
            <div className={styles.actions}>
              <button 
                className={styles.iconBtn} 
                onClick={(e) => { e.stopPropagation(); onChange(layer.id, { visible: !isVisible }); }}
                title="Visibilidade"
              >
                {isVisible ? <Eye size={13} /> : <EyeOff size={13} style={{ opacity: 0.5 }} />}
              </button>
              <button 
                className={styles.iconBtn} 
                onClick={(e) => { e.stopPropagation(); onChange(layer.id, { locked: !isLocked }); }}
                title="Travar camada"
              >
                {isLocked ? <Lock size={13} /> : <Unlock size={13} style={{ opacity: 0.2 }} />}
              </button>
            </div>
            <div className={styles.icon}>{getLayerIcon(layer)}</div>
            {editingLayerId === layer.id ? (
              <input
                autoFocus
                className={styles.renameInput}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => {
                  onChange(layer.id, { name: editingName });
                  setEditingLayerId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditingLayerId(null);
                }}
              />
            ) : (
              <div 
                className={styles.label} 
                onDoubleClick={() => {
                  setEditingLayerId(layer.id);
                  setEditingName(layer.name || getLayerLabel(layer));
                }}
              >
                {getLayerLabel(layer)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
