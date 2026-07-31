'use client';

import React, { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../../login/login.module.css';

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const nextUrl = searchParams.get('next') || '/galeria';

    if (token) {
      localStorage.setItem('auth_token', token);
      document.cookie = `auth_token=${token}; path=/; max-age=604800`; // 7 dias

      if (nextUrl && nextUrl.startsWith('/')) {
        router.push(nextUrl);
      } else {
        router.push('/galeria');
      }
    } else {
      router.push('/login?error=oauth_failed');
    }
  }, [searchParams, router]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoArea}>
          <img
            src="/assinatura-logo.svg"
            alt="Assinatura Design Studio"
            className={styles.logo}
            width={140}
            height={40}
          />
          <p className={styles.logoSub}>Autenticando com o Google...</p>
        </div>
        <p className={styles.hint}>Aguarde, concluindo o seu login.</p>
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <div className={styles.card}>
            <p className={styles.hint}>Carregando...</p>
          </div>
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}
