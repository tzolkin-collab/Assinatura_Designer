'use client';

import { useRef } from 'react';
import { ImageIcon, UploadCloud, Loader2 } from 'lucide-react';
import { useBrandAssets, type BrandAsset } from '@/hooks/useBrandAssets';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';

interface Props {
  slug: string;
  /** Chamado ao clicar num asset. Recebe a URL permanente (R2). */
  onSelect: (asset: BrandAsset) => void;
  /** Rótulo do que acontece ao clicar — muda entre "inserir" e "trocar". */
  actionLabel?: string;
  compact?: boolean;
}

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Biblioteca de mídia da marca dentro do editor.
 *
 * Antes o editor tinha um "Upload de Imagem" que chamava URL.createObjectURL(file)
 * e inseria um `blob:` como src da imagem — endereço válido só naquela aba. Ao
 * salvar, o post guardava uma URL morta: ninguém mais via a imagem, nem o próprio
 * usuário depois de um reload. Aqui o arquivo vai para a biblioteca da marca e
 * volta com URL permanente do R2.
 */
export default function AssetLibrary({ slug, onSelect, actionLabel = 'Inserir', compact }: Props) {
  const { assets, loading, uploading, error, upload } = useBrandAssets(slug);
  const { can, hint } = useBrandPermissions();
  const canUpload = can('manage-assets');
  const inputRef = useRef<HTMLInputElement>(null);

  const imagens = assets.filter((a) => a.fileType.startsWith('image/'));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      alert('A imagem não pode ultrapassar 10MB.');
      return;
    }
    const asset = await upload(file);
    // Sobe e já insere: é o que o usuário quer quando arrasta um arquivo pro editor.
    if (asset) onSelect(asset);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label
        title={canUpload ? undefined : hint}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px',
          border: '1px dashed rgba(0,0,0,0.15)',
          borderRadius: 8,
          cursor: canUpload ? 'pointer' : 'not-allowed',
          opacity: canUpload ? 1 : 0.5,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
        <span>{uploading ? 'Enviando...' : 'Enviar para a biblioteca'}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={!canUpload || uploading}
          style={{ display: 'none' }}
          onChange={handleFile}
        />
      </label>

      {error && (
        <p style={{ fontSize: 11, color: '#ef4444', margin: 0 }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>Carregando biblioteca...</p>
      ) : imagens.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0 }}>
          A biblioteca desta marca está vazia. Envie uma imagem para reutilizá-la em qualquer design.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
            gap: 6,
          }}
        >
          {imagens.map((asset) => (
            <button
              key={asset.id}
              onClick={() => onSelect(asset)}
              title={`${actionLabel}: ${asset.name}`}
              style={{
                padding: 0,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'var(--color-bg-secondary)',
                aspectRatio: '1 / 1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.url}
                alt={asset.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}

      {!loading && imagens.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--color-text-dim)', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ImageIcon size={11} /> {imagens.length} imagem(ns) — clique para {actionLabel.toLowerCase()}
        </p>
      )}
    </div>
  );
}
