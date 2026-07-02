'use client';

import { Layers, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Section, Field, ColorSwatch } from './shared';

interface Props {
  color: string;
  backgroundImage?: string;
  onChange: (color: string) => void;
  onBgImageChange: (url: string | undefined) => void;
}

export default function BackgroundPanel({ color, backgroundImage, onChange, onBgImageChange }: Props) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      onBgImageChange(url);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      <p
        style={{
          fontSize: 11,
          color: 'var(--color-text-tertiary)',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Nenhuma camada selecionada. Edite o fundo do slide ou clique em um elemento no canvas.
      </p>

      <Section title="Fundo" icon={<Layers size={11} />}>
        <Field label="Cor do fundo">
          <ColorSwatch id="bg-color" value={color} onChange={onChange} />
        </Field>
      </Section>

      <Section title="Imagem de Fundo" icon={<ImageIcon size={11} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {backgroundImage ? (
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={backgroundImage} alt="Background" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button 
                onClick={() => onBgImageChange(undefined)}
                style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: 4, padding: 4, cursor: 'pointer' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ) : (
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px', border: '1px dashed rgba(0,0,0,0.1)', borderRadius: 8,
              cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)',
              backgroundColor: 'var(--color-surface)'
            }}>
              <ImageIcon size={14} />
              <span>Fazer upload de imagem</span>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            </label>
          )}
        </div>
      </Section>
    </div>
  );
}
