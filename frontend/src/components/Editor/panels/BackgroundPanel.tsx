'use client';

import { useParams } from 'next/navigation';
import { Layers, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Section, Field, ColorSwatch } from './shared';
import AssetLibrary from '@/components/Editor/AssetLibrary';

interface Props {
  color: string;
  backgroundImage?: string;
  onChange: (color: string) => void;
  onBgImageChange: (url: string | undefined) => void;
}

export default function BackgroundPanel({ color, backgroundImage, onChange, onBgImageChange }: Props) {
  const params = useParams();
  const slug = params.marca as string;

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
            // Antes isto era um input que fazia URL.createObjectURL(file) e mandava um
            // `blob:` como fundo do slide — URL válida só naquela aba. O post era salvo
            // com um fundo que não existia para mais ninguém.
            <AssetLibrary
              slug={slug}
              actionLabel="Usar como fundo"
              compact
              onSelect={(asset) => onBgImageChange(asset.url)}
            />
          )}
        </div>
      </Section>
    </div>
  );
}
