'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ImageIcon } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Field, NumInput, inputCss } from './shared';
import AssetLibrary from '@/components/Editor/AssetLibrary';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function ImagePanel({ layer, onChange }: Props) {
  const id = layer.id;
  const params = useParams();
  const slug = params.marca as string;
  const [tab, setTab] = useState<'url' | 'biblioteca'>('biblioteca');

  const tabCss = (ativa: boolean) => ({
    flex: 1,
    padding: '4px 0',
    fontSize: 10,
    borderRadius: 4,
    border: 'none',
    background: ativa ? 'var(--color-bg-primary)' : 'transparent',
    color: ativa ? 'var(--color-text)' : 'var(--color-text-tertiary)',
    cursor: 'pointer',
    boxShadow: ativa ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
  });

  return (
    <Section title="Imagem" icon={<ImageIcon size={11} />}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: 'var(--color-bg-secondary)', padding: 2, borderRadius: 6 }}>
        <button onClick={() => setTab('biblioteca')} style={tabCss(tab === 'biblioteca')}>
          Biblioteca
        </button>
        <button onClick={() => setTab('url')} style={tabCss(tab === 'url')}>
          URL
        </button>
      </div>

      {tab === 'url' ? (
        <Field label="URL">
          <input
            key={`${id}-url`}
            type="text"
            style={{ ...inputCss, fontSize: 11 }}
            defaultValue={layer.url ?? ''}
            placeholder="https://..."
            onBlur={(e) => onChange({ url: e.target.value || undefined })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </Field>
      ) : (
        // A aba "Upload" antiga mandava o arquivo para /upload — rota genérica, que
        // larga o objeto num balde solto do R2 e NÃO cria linha em `Asset`. A imagem
        // não voltava para a biblioteca e não podia ser reusada em outro design.
        // Aqui o upload vai para a biblioteca da marca e a troca é feita a partir dela.
        <AssetLibrary
          slug={slug}
          actionLabel="Trocar"
          compact
          onSelect={(asset) => onChange({ url: asset.url })}
        />
      )}

      <Field label="Arredondamento">
        <NumInput
          id={`${id}-ibr`}
          defaultVal={layer.borderRadius ?? 0}
          onCommit={(v) => onChange({ borderRadius: v })}
          suffix="px"
          min={0}
        />
      </Field>
    </Section>
  );
}
