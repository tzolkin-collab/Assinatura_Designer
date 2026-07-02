'use client';

import { useState, useRef } from 'react';
import { ImageIcon, UploadCloud } from 'lucide-react';
import type { Layer } from '@/components/Fabrica/DesignRenderer';
import { Section, Field, NumInput, inputCss } from './shared';
import { api } from '@/lib/api';

interface Props {
  layer: Layer;
  onChange: (overrides: Partial<Layer>) => void;
}

export default function ImagePanel({ layer, onChange }: Props) {
  const id = layer.id;
  const [tab, setTab] = useState<'url' | 'upload'>('url');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (e.g. 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('A imagem não pode ultrapassar 10MB.');
      return;
    }

    setUploading(true);
    try {
      const data = await api.uploadFile<{ url: string }>('/upload', file);
      if (data && data.url) {
        onChange({ url: data.url });
      }
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Falha ao fazer upload da imagem.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Section title="Imagem" icon={<ImageIcon size={11} />}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: 'var(--color-bg-secondary)', padding: 2, borderRadius: 6 }}>
        <button
          onClick={() => setTab('url')}
          style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, border: 'none', background: tab === 'url' ? 'var(--color-bg-primary)' : 'transparent', color: tab === 'url' ? 'var(--color-text)' : 'var(--color-text-tertiary)', cursor: 'pointer', boxShadow: tab === 'url' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
        >
          URL
        </button>
        <button
          onClick={() => setTab('upload')}
          style={{ flex: 1, padding: '4px 0', fontSize: 10, borderRadius: 4, border: 'none', background: tab === 'upload' ? 'var(--color-bg-primary)' : 'transparent', color: tab === 'upload' ? 'var(--color-text)' : 'var(--color-text-tertiary)', cursor: 'pointer', boxShadow: tab === 'upload' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}
        >
          Upload
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
        <Field label="Arquivo">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px',
                border: '1px dashed var(--color-border-strong)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-secondary)',
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontSize: 11,
              }}
            >
              {uploading ? (
                <span>Fazendo upload...</span>
              ) : (
                <>
                  <UploadCloud size={14} /> Escolher Imagem (Max 10MB)
                </>
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: 'none' }}
            />
          </div>
        </Field>
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
