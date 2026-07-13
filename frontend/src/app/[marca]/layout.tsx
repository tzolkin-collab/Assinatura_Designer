'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useBranding } from '@/hooks/useBranding';
import { BrandPermissionsProvider } from '@/hooks/useBrandPermissions';

export default function MarcaLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = params.marca as string;

  // Carrega as fontes e injeta as variáveis CSS da marca
  useBranding(slug);

  // O papel do usuário nesta marca é buscado uma vez aqui e usado por todas as páginas
  // para desabilitar (em vez de deixar falhar com 403) o que ele não pode fazer.
  return <BrandPermissionsProvider slug={slug}>{children}</BrandPermissionsProvider>;
}
