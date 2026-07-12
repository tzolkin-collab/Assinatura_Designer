'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useBranding } from '@/hooks/useBranding';

export default function MarcaLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = params.marca as string;

  // Carrega as fontes e injeta as variáveis CSS da marca
  useBranding(slug);

  return <>{children}</>;
}
