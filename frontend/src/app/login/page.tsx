'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
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
      // Import api inside the function to avoid circular/SSR issues with localStorage if not careful, 
      // or just ensure api.ts handles SSR gracefully (which it does via typeof window).
      const { api } = await import('@/lib/api');
      
      const response = await api.post<{ token: string }>('/auth/login', {
        email,
        password,
      }, { requireAuth: false });

      const { token } = response;
      localStorage.setItem('auth_token', token);
      document.cookie = `auth_token=${token}; path=/; max-age=604800`; // 7 days
      
      router.push('/galeria');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar.';
      setError(message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoArea}>
          <div className={styles.logoMark}>A</div>
          <h1 className={styles.logoTitle}>Assinatura</h1>
          <p className={styles.logoSub}>Design Studio</p>
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

        <p className={styles.hint}>
          Use <strong>admin@assinatura.com</strong> / <strong>admin</strong>
        </p>
      </div>
    </div>
  );
}
