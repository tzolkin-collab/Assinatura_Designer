'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, User as UserIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import styles from '../login/login.module.css';

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || searchParams.get('next');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !email || !password) {
      setError('Preencha todos os campos.');
      return;
    }

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const { api } = await import('@/lib/api');

      const response = await api.post<{ user: { id: string; email: string }; token: string }>(
        '/auth/register',
        { name, email, password },
        { requireAuth: false },
      );

      const { token } = response;
      localStorage.setItem('auth_token', token);
      document.cookie = `auth_token=${token}; path=/; max-age=604800`; // 7 dias

      // Redireciona para o projeto/página de destino solicitada ou para a galeria
      if (redirectTo && redirectTo.startsWith('/')) {
        router.push(redirectTo);
      } else {
        router.push('/galeria');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao criar conta.';
      setError(message || 'Falha ao criar conta.');
    } finally {
      setLoading(false);
    }
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
          <p className={styles.logoSub}>Criar Conta no Design Studio</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className={styles.form}>
          <Input
            label="Seu nome"
            type="text"
            placeholder="Como quer ser chamado"
            value={name}
            onChange={(e) => setName(e.target.value)}
            icon={<UserIcon size={16} />}
          />
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail size={16} />}
          />
          <Input
            label="Crie sua senha"
            type="password"
            placeholder="Mínimo 8 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            icon={<Lock size={16} />}
          />

          {error && <p className={styles.error}>{error}</p>}

          <Button type="submit" fullWidth loading={loading}>
            Cadastrar e Acessar
          </Button>
        </form>

        <p className={styles.hint}>
          Já possui uma conta?{' '}
          <Link href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'} style={{ color: 'var(--color-brand, #FF6B35)', textDecoration: 'underline' }}>
            Fazer Login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.hint}>Carregando...</p>
        </div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  );
}
