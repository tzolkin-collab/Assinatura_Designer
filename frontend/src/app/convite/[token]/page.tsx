'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import styles from '../../login/login.module.css';

interface InviteInfo {
  email: string;
  role: string;
  brand: { name: string; slug: string };
  expiresAt: string;
}

/**
 * Aceite de convite: quem chega aqui ainda não tem conta. A prova de acesso é o
 * token do link — por isso as chamadas vão com `requireAuth: false`.
 */
export default function ConvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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

      router.push(invite ? `/${invite.brand.slug}` : '/galeria');
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

  if (!invite) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.logoArea}>
            <div className={styles.logoMark}>A</div>
            <h1 className={styles.logoTitle}>Convite inválido</h1>
          </div>
          <p className={styles.error}>{error}</p>
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
            Convite como {invite.role.toLowerCase()} — {invite.email}
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
            {submitting ? 'Criando conta…' : 'Aceitar convite'}
          </button>
        </form>
      </div>
    </div>
  );
}
