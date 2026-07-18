'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import styles from '../../login/login.module.css';

interface InviteInfo {
  email: string;
  role: string;
  brand: { name: string; slug: string };
  expiresAt: string;
}

function TeammateRegisterContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Token de convite ausente.');
      setLoading(false);
      return;
    }

    api
      .get<InviteInfo>(`/auth/invite/${token}`, { requireAuth: false })
      .then((data) => {
        setInvite(data);
        setName(data.email.split('@')[0] ?? '');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Convite inválido ou expirado.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) return;

    if (password.length < 8) {
      setError('A senha deve ter ao menos 8 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ token: string }>(
        `/auth/invite/${token}/accept`,
        { name, password },
        { requireAuth: false },
      );

      localStorage.setItem('auth_token', res.token);
      document.cookie = `auth_token=${res.token}; path=/; max-age=604800`;

      router.push(invite ? `/${invite.brand.slug}/galeria` : '/galeria');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Não foi possível aceitar o convite.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.hint}>Verificando convite…</p>
        </div>
      </div>
    );
  }

  if (!invite || error) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.logoArea}>
            <div className={styles.logoMark}>A</div>
            <h1 className={styles.logoTitle}>Convite inválido</h1>
          </div>
          <p className={styles.error}>{error || 'O convite solicitado não pôde ser encontrado.'}</p>
          <p className={styles.hint}>
            Peça um novo convite a quem administra a marca — cada link vale uma única vez.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoArea}>
          <div className={styles.logoMark}>A</div>
          <h1 className={styles.logoTitle}>{invite.brand.name}</h1>
          <p className={styles.logoSub}>
            Registro de Teammate ({invite.role.toLowerCase()}) — {invite.email}
          </p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label>
            Seu nome
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como você quer ser chamado"
            />
          </label>

          <label>
            Crie uma senha
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ao menos 8 caracteres"
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Criando conta…' : 'Finalizar Registro'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function TeammateRegisterPage() {
  return (
    <Suspense fallback={
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.hint}>Carregando…</p>
        </div>
      </div>
    }>
      <TeammateRegisterContent />
    </Suspense>
  );
}
