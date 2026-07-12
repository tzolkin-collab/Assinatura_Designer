import React, { useState } from 'react';
import { type DesignIR, type IRPatch, type SlideNode } from '../../lib/designIR/types';
import { Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../ui/Button';

interface AIEditBarProps {
  ir: DesignIR;
  activeSlide: SlideNode;
  slideIndex: number;
  selectedElementIds: string[];
  slug: string;
  postId: string;
  onPatch: (patch: IRPatch) => void;
}

export default function AIEditBar({ slideIndex, selectedElementIds, postId, onPatch }: AIEditBarProps) {
  const [instruction, setInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEdit = async () => {
    if (!instruction.trim() || isEditing) return;
    setIsEditing(true);
    setError(null);
    try {
      const res = await api.post<{ patch?: IRPatch }>(`/posts/${postId}/ai-patch`, {
        instruction,
        slideIndex,
        selectedElementIds,
      });

      if (res?.patch?.ops?.length) {
        onPatch(res.patch);
        setInstruction('');
      } else {
        setError('Não consegui aplicar essa alteração. Tente reformular o pedido.');
      }
    } catch (e) {
      console.error('[ai-patch]', e);
      setError(e instanceof Error ? e.message : 'Falha ao editar com IA.');
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <>
    {error && (
      <div style={{
        position: 'absolute',
        bottom: 76,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#fef2f2',
        color: '#991b1b',
        border: '1px solid #fecaca',
        padding: '6px 12px',
        borderRadius: 8,
        fontSize: 12,
        maxWidth: 560,
        zIndex: 101,
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      }}>
        {error}
      </div>
    )}
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(8px)',
      padding: '8px 16px',
      borderRadius: 999,
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      border: '1px solid rgba(0,0,0,0.08)',
      width: '90%',
      maxWidth: 600,
      zIndex: 100
    }}>
      <Wand2 size={18} color="#4f46e5" />
      <input 
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleEdit();
        }}
        placeholder={selectedElementIds.length > 0 ? "O que mudar nos itens selecionados?" : "Descreva a alteração que deseja fazer no slide..."}
        style={{
          flex: 1,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: 14,
          color: '#1f2937'
        }}
        disabled={isEditing}
      />
      <Button 
        onClick={handleEdit} 
        disabled={isEditing || !instruction.trim()}
        style={{ borderRadius: 999, padding: '6px 16px', fontSize: 13 }}
      >
        {isEditing ? 'Pensando...' : 'Aplicar'}
      </Button>
    </div>
    </>
  );
}
