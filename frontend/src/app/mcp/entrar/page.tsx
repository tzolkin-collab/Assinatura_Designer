'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import { readPreviewCode, sessionCookie } from '@/lib/previewEntry';
import styles from '../consent/consent.module.css';

interface ExchangeResult {
  token: string;
  expiresAt: string;
  brands: Array<{ slug: string; name: string }>;
}

/**
 * Entrada de um agente de IA no Designer, só para VER (modo leitura, 2 h). Chega aqui pela URL que a ferramenta
 * `start_frontend_session` devolve: `/mcp/entrar#code=...`. Ver `lib/previewEntry.ts`.
 */
export default function McpEntrarPage() {
  const started = useRef(false);
  const [state, setState] = useState<'working' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // O modo estrito do React roda o efeito duas vezes; o código só pode ser trocado uma.
    if (started.current) return;
    started.current = true;

    const code = readPreviewCode(window.location.hash);
    // Apaga o código da barra de endereço ANTES de qualquer rede: depois disto a URL não carrega mais nada reutilizável.
    window.history.replaceState(null, '', window.location.pathname);

    if (!code) {
      setMessage('Este link está incompleto ou já foi aberto. Peça ao agente um link novo.');
      setState('failed');
      return;
    }

    api
      .post<ExchangeResult>('/mcp/preview/exchange', { code }, { requireAuth: false })
      .then((session) => {
        localStorage.setItem('auth_token', session.token);
        document.cookie = sessionCookie(session.token, session.expiresAt, {
          secure: window.location.protocol === 'https:',
          nowMs: Date.now(),
        });
        window.location.replace('/galeria');
      })
      .catch((err: unknown) => {
        setMessage(getApiErrorMessage(err, 'Não foi possível abrir a sessão. Peça um link novo ao agente.'));
        setState('failed');
      });
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <p className={styles.eyebrow}>Sessão do agente</p>
        {state === 'working' ? (
          <>
            <h1 className={styles.title}>Abrindo o Designer…</h1>
            <p className={styles.lead}>Modo somente leitura, por até 2 horas.</p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Não foi possível abrir</h1>
            <p className={styles.lead} role="alert">
              {message}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
