'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    
    // Constrói a URL de callback do backend
    const redirectUrl = new URL(`${backendUrl}/api/google/callback`);
    if (code) redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    if (error) redirectUrl.searchParams.set('error', error);

    // Redireciona o navegador para o backend processar os tokens
    window.location.href = redirectUrl.toString();
  }, [router, searchParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#4b5563' }}>
      <div style={{ border: '4px solid #f3f3f3', borderTop: '4px solid #3b82f6', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite' }} />
      <p style={{ marginTop: '16px' }}>Conectando com o Google Drive...</p>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function GoogleDriveCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#4b5563' }}>
        <p>Carregando...</p>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
