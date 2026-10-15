'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getApiErrorMessage } from '@/lib/api';
import { describeAccess, isLocalServerUrl, mcpApi, mcpServerUrl, plainText, type McpConnection } from '@/lib/mcp';
import styles from './agentes.module.css';

type LoadState = 'loading' | 'ready' | 'off' | 'error';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const joinNames = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
};

export default function AgentesDeIA() {
  const serverUrl = mcpServerUrl();
  const local = isLocalServerUrl(serverUrl);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConnections(await mcpApi.listConnections());
      setState('ready');
    } catch (err) {
      // O módulo é opcional (MCP_ENABLED): sem ele as rotas não existem e a API responde 404.
      if (err instanceof ApiError && err.status === 404) setState('off');
      else {
        setError(getApiErrorMessage(err, 'Não foi possível carregar as conexões.'));
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o campo continua selecionável.
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await mcpApi.revokeConnection(id);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Não foi possível desconectar.'));
      setState('error');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="agentes-titulo">
      <h2 id="agentes-titulo" className={styles.title}>
        Agentes de IA
      </h2>
      <p className={styles.lead}>
        Um agente (ChatGPT, Claude, Gemini) lê o kit de uma marca, desenha a peça e salva aqui. O que ele salva aparece no
        editor, como qualquer outra peça. O trabalho do agente roda na assinatura de quem o usa.
      </p>

      {state === 'off' ? (
        <p className={styles.off}>A conexão de agentes não está ligada neste servidor. Quem administra a instalação a ativa em MCP_ENABLED.</p>
      ) : (
        <>
          <div className={styles.field}>
            <label htmlFor="mcp-url" className={styles.label}>
              Endereço do servidor
            </label>
            <div className={styles.urlRow}>
              <input
                id="mcp-url"
                className={styles.url}
                value={serverUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className={styles.copy} onClick={copy}>
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            {local && (
              <p className={styles.hint}>
                Este endereço é local. O ChatGPT e o Claude só alcançam um endereço HTTPS público.
              </p>
            )}
          </div>

          <details className={styles.how}>
            <summary>Como conectar</summary>
            <ol>
              <li>
                <strong>ChatGPT:</strong> em Configurações, ative o modo desenvolvedor, crie um conector e cole o endereço.
                Escolha autenticação OAuth.
              </li>
              <li>
                <strong>Claude:</strong> em Configurações → Conectores, adicione um conector personalizado e cole o endereço.
              </li>
              <li>
                <strong>Gemini Spark:</strong> em Aplicativos conectados, adicione um app personalizado com o endereço.
              </li>
              <li>O agente abre uma tela do Designer para você escolher as marcas e aprovar. Os nomes dos menus mudam com o plano e a versão de cada agente.</li>
            </ol>
          </details>

          <h3 className={styles.subtitle}>Conexões ativas</h3>
          {state === 'loading' && <p className={styles.muted}>Carregando…</p>}
          {state === 'error' && (
            <p className={styles.error} role="alert">
              {error}{' '}
              <button type="button" className={styles.inline} onClick={() => void load()}>
                Tentar de novo
              </button>
            </p>
          )}
          {state === 'ready' && connections.length === 0 && <p className={styles.muted}>Nenhum agente conectado.</p>}
          {state === 'ready' && connections.length > 0 && (
            <ul className={styles.list}>
              {connections.map((c) => {
                const brandNames = c.brands.map((b) => b.name);
                const ask = confirming === c.id;
                return (
                  <li key={c.id} className={styles.item}>
                    <div className={styles.itemText}>
                      <div className={styles.itemName}>{plainText(c.clientName)}</div>
                      <div className={styles.itemMeta}>
                        {[
                          brandNames.length ? joinNames(brandNames) : 'Sem marcas ativas',
                          describeAccess(c.scopes),
                          fmtDate(c.createdAt) && `conectado em ${fmtDate(c.createdAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {ask ? (
                      <div className={styles.confirm}>
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => void revoke(c.id)}
                          disabled={revoking === c.id}
                        >
                          {revoking === c.id ? 'Desconectando…' : 'Desconectar'}
                        </button>
                        <button type="button" className={styles.inline} onClick={() => setConfirming(null)} disabled={revoking === c.id}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={styles.inline} onClick={() => setConfirming(c.id)}>
                        Desconectar…
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {state === 'ready' && connections.length > 0 && (
            <p className={styles.hint}>Desconectar impede novos acessos do agente. As peças que ele já salvou continuam no Designer.</p>
          )}
        </>
      )}
    </section>
  );
}
