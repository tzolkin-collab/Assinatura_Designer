'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import styles from './login.module.css';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || searchParams.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Preencha todos os campos.');
      return;
    }

    setLoading(true);

    try {
      const { api } = await import('@/lib/api');

      const response = await api.post<{ token: string }>('/auth/login', {
        email,
        password,
      }, { requireAuth: false });

      const { token } = response;
      localStorage.setItem('auth_token', token);
      document.cookie = `auth_token=${token}; path=/; max-age=604800`; // 7 dias

      if (redirectTo && redirectTo.startsWith('/')) {
        router.push(redirectTo);
      } else {
        router.push('/galeria');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar.';
      setError(message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const redirectParam = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : '';
    window.location.href = `${apiBase}/auth/google/login${redirectParam}`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoArea}>
          <img
            src="/assinatura-logo.svg"
            alt="Assinatura Design Studio"
            className={styles.logo}
            width={140}
            height={40}
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className={styles.form}>
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail size={16} />}
          />
          <Input
            label="Senha"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            icon={<Lock size={16} />}
          />

          {error && <p className={styles.error}>{error}</p>}

          <Button type="submit" fullWidth loading={loading}>
            Entrar
          </Button>
        </form>

        <div className={styles.divider}>
          <span>OU</span>
        </div>

        <button type="button" onClick={handleGoogleLogin} className={styles.googleBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Entrar com o Google
        </button>

        <p className={styles.hint}>
          Ainda não tem conta?{' '}
          <Link
            href={redirectTo ? `/register?redirect=${encodeURIComponent(redirectTo)}` : '/register'}
            style={{ color: 'var(--color-brand, #FF6B35)', textDecoration: 'underline' }}
          >
            Cadastre-se aqui
          </Link>
        </p>

        <p className={styles.hint} style={{ marginTop: 'var(--space-2)' }}>
          Ou use <strong>admin@assinatura.com</strong> / <strong>admin123</strong>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.hint}>Carregando...</p>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
