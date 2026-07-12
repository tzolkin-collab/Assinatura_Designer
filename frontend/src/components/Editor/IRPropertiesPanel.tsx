import React from 'react';
import { type IRPatch, type SlideNode, type ElementNode, type ElementStyle } from '../../lib/designIR/types';

interface IRPropertiesPanelProps {
  slide: SlideNode;
  selectedElements: ElementNode[];
  onPatch: (patch: IRPatch) => void;
}

export default function IRPropertiesPanel({ slide, selectedElements, onPatch }: IRPropertiesPanelProps) {
  if (selectedElements.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        Selecione um elemento para editar suas propriedades.
      </div>
    );
  }

  const el = selectedElements[0];

  const updateStyle = (key: keyof ElementStyle, value: any) => {
    onPatch({
      ops: [{
        op: 'update-style',
        slideId: slide.id,
        elementId: el.id,
        style: { [key]: value }
      }]
    });
  };

  const updateContent = (content: string) => {
    onPatch({
      ops: [{
        op: 'update-content',
        slideId: slide.id,
        elementId: el.id,
        content
      }]
    });
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#111827' }}>Propriedades</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {el.type === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Texto</label>
            <textarea 
              value={el.content || ''} 
              onChange={e => updateContent(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, minHeight: 60 }}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Fonte</label>
          <input 
            type="number" 
            value={el.style.fontSize || 16} 
            onChange={e => updateStyle('fontSize', parseInt(e.target.value))}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Cor</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input 
              type="color" 
              value={el.style.color || '#000000'} 
              onChange={e => updateStyle('color', e.target.value)}
              style={{ width: 32, height: 32, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{el.style.color || '#000000'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Alinhamento</label>
          <select 
            value={el.style.textAlign || 'left'} 
            onChange={e => updateStyle('textAlign', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            <option value="left">Esquerda</option>
            <option value="center">Centro</option>
            <option value="right">Direita</option>
            <option value="justify">Justificado</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Fundo</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input 
              type="color" 
              value={el.style.backgroundColor || '#ffffff'} 
              onChange={e => updateStyle('backgroundColor', e.target.value)}
              style={{ width: 32, height: 32, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{el.style.backgroundColor || 'none'}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
