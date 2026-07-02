'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FabricaChat } from '@/components/FabricaChat';
import { API_BASE } from '@/lib/api';

interface BrandData {
  name: string;
  slug: string;
}

export default function DesignerPage() {
  const params = useParams();
  const marca = params['marca'] as string;

  const [brand, setBrand] = useState<BrandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!marca) return;

    fetch(`${API_BASE}/brands/${marca}`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) { setNotFound(true); return; }
        const data = await res.json() as { brand?: BrandData; name?: string; slug?: string };
        setBrand(data.brand ?? (data as BrandData));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [marca]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text-tertiary)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-sans)',
      }}>
        Carregando...
      </div>
    );
  }

  if (notFound || !brand) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-sans)',
      }}>
        Marca não encontrada.
      </div>
    );
  }

  return (
    <FabricaChat
      brandSlug={brand.slug}
      brandName={brand.name}
      marca={marca}
    />
  );
}
