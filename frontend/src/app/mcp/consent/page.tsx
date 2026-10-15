'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getApiErrorMessage } from '@/lib/api';
import {
  EDIT_ALL_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  formatRemaining,
  mcpApi,
  plainText,
  roleLabel,
  type ConsentRequest,
} from '@/lib/mcp';
import Button from '@/components/ui/Button';
import styles from './consent.module.css';

type Access = 'read' | 'write' | 'edit_all';

function ConsentContent() {
  const requestId = useSearchParams().get('request');

  const [data, setData] = useState<ConsentRequest | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<Access>('read');
  const [allBrands, setAllBrands] = useState(false);
  const [sending, setSending] = useState<'approve' | 'deny' | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setState('gone');
      return;
    }
    let alive = true;
    mcpApi
      .getConsent(requestId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setState('ready');
        const selectable = d.brands.filter((b) => b.selectable);
        // Uma marca só: já vem marcada. Com várias, quem aprova escolhe (menor privilégio).
        if (selectable.length === 1) setSelected(new Set([selectable[0]!.slug]));
        // Pediu escrita: começa em "só ver" e a pessoa promove de propósito.
        setAccess('read');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const status = (err as { status?: number })?.status;
        if (status === 404) setState('gone');
        else {
          setError(getApiErrorMessage(err, 'Não foi possível carregar este pedido.'));
          setState('error');
        }
      });
    return () => {
      alive = false;
    };
  }, [requestId]);

  // Quem decide é o usuário: as opções de escrita aparecem mesmo que o agente tenha pedido só leitura
  // (alguns, como o Claude ao conectar por URL, pedem só leitura). `asked*` só alimenta o aviso.
  const askedWrite = Boolean(data?.scopes.includes(WRITE_SCOPE) || data?.scopes.includes(EDIT_ALL_SCOPE));
  const wantsEditAll = Boolean(data);
  const wantsWrite = Boolean(data);
  const writing = access !== 'read';
  const clientName = data ? plainText(data.client.name) : '';

  const brandRows = useMemo(() => {
    if (!data) return [];
    return data.brands.map((b) => {
      const writeBlocked = writing && !b.canWrite;
      return { ...b, disabled: !b.selectable || writeBlocked, writeBlocked };
    });
  }, [data, writing]);

  // Trocar para "ver e salvar" desmarca as marcas em que a pessoa não pode escrever.
  useEffect(() => {
    if (!writing || !data) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((slug) => data.brands.find((b) => b.slug === slug)?.canWrite));
      return next.size === prev.size ? prev : next;
    });
  }, [writing, data]);

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const decide = async (decision: 'approve' | 'deny') => {
    if (!requestId || !data) return;
    setError('');
    setSending(decision);
    try {
      const scopes =
        decision === 'approve'
          ? access === 'edit_all' && wantsEditAll
            ? [EDIT_ALL_SCOPE]
            : access !== 'read' && wantsWrite
              ? [WRITE_SCOPE]
              : [READ_SCOPE]
          : undefined;
      const { redirectUrl } = await mcpApi.decideConsent(requestId, {
        decision,
        ...(decision === 'approve'
          ? allBrands
            ? { allBrands: true, scopes }
            : { brandSlugs: [...selected], scopes }
          : {}),
      });
      setLeaving(true);
      window.location.href = redirectUrl;
    } catch (err) {
      setError(getApiErrorMessage(err, 'Não foi possível concluir. Tente de novo.'));
      setSending(null);
    }
  };

  if (state === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Carregando o pedido…</p>
      </main>
    );
  }

  if (state === 'gone' || state === 'error' || !data) {
    return (
      <main className={styles.page}>
        <div className={styles.column}>
          <h1 className={styles.title}>{state === 'error' ? 'Não foi possível abrir o pedido' : 'Este pedido não vale mais'}</h1>
          <p className={styles.lead}>
            {state === 'error'
              ? error
              : 'Ele expirou, já foi usado ou o link está incompleto. Volte ao agente e peça a conexão de novo.'}
          </p>
          <Link className={styles.link} href="/configuracoes/integracoes">
            Ir para Integrações
          </Link>
        </div>
      </main>
    );
  }

  const hasAnyBrand = allBrands ? data.brands.some((b) => !writing || b.canWrite) : selected.size > 0;
  const canApprove = hasAnyBrand && !sending && !leaving;

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <p className={styles.eyebrow}>Pedido de acesso</p>
        <h1 className={styles.title}>{clientName} quer usar o Designer</h1>
        <p className={styles.lead}>
          Se aprovar, ele poderá ler o material das marcas que você escolher
          {wantsWrite ? ' e, se você permitir, salvar peças nelas' : ''}. Ele volta para <strong>{data.client.redirectHost}</strong>.
        </p>

        <dl className={styles.facts}>
          <div>
            <dt>Quem pede</dt>
            <dd>{clientName}</dd>
          </div>
          <div>
            <dt>Volta para</dt>
            <dd>{data.client.redirectHost}</dd>
          </div>
          <div>
            <dt>Pedido válido por</dt>
            <dd>{formatRemaining(data.expiresInSeconds)}</dd>
          </div>
        </dl>

        <p className={styles.note}>Se você não começou esta conexão agora, recuse.</p>

        <fieldset className={styles.group}>
          <legend>Marcas</legend>
          {brandRows.length > 1 && (
            <>
              <label className={styles.option}>
                <input type="radio" name="brandMode" checked={!allBrands} onChange={() => setAllBrands(false)} />
                <span className={styles.optionText}>
                  <span>Só as marcas que eu escolher</span>
                  <span className={styles.optionHint}>A conexão enxerga apenas as marcas marcadas abaixo.</span>
                </span>
              </label>
              <label className={styles.option}>
                <input type="radio" name="brandMode" checked={allBrands} onChange={() => setAllBrands(true)} />
                <span className={styles.optionText}>
                  <span>Todas as minhas marcas</span>
                  <span className={styles.optionHint}>
                    Vale também para marcas em que você entrar depois, e deixa de valer para as que você perder. O que o
                    agente pode fazer em cada uma segue o seu papel nela.
                  </span>
                </span>
              </label>
            </>
          )}
          {allBrands ? (
            <p className={styles.muted}>
              {brandRows.filter((b) => !b.writeBlocked).length} marca(s) hoje:{' '}
              {brandRows
                .filter((b) => !b.writeBlocked)
                .map((b) => b.name)
                .join(', ')}
              .
            </p>
          ) : brandRows.length === 0 ? (
            <p className={styles.muted}>Você não participa de nenhuma marca.</p>
          ) : (
            brandRows.map((b) => (
              <label key={b.slug} className={`${styles.option} ${b.disabled ? styles.optionOff : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(b.slug)}
                  disabled={b.disabled}
                  onChange={() => toggle(b.slug)}
                />
                <span className={styles.optionText}>
                  <span>{b.name}</span>
                  <span className={styles.optionHint}>
                    {b.writeBlocked ? `${roleLabel(b.role)}: só editores salvam peças` : roleLabel(b.role)}
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>O que o agente pode fazer</legend>
          {!askedWrite && (
            <p className={styles.note}>
              {clientName} pediu só leitura. Você pode liberar mais abaixo; vale só para esta conexão e você revoga quando
              quiser.
            </p>
          )}
          <label className={styles.option}>
            <input type="radio" name="access" checked={access === 'read'} onChange={() => setAccess('read')} />
            <span className={styles.optionText}>
              <span>Só ver</span>
              <span className={styles.optionHint}>Lê o kit da marca e as peças existentes.</span>
            </span>
          </label>
          {wantsWrite && (
            <label className={styles.option}>
              <input type="radio" name="access" checked={access === 'write'} onChange={() => setAccess('write')} />
              <span className={styles.optionText}>
                <span>Ver e salvar peças</span>
                <span className={styles.optionHint}>
                  Cria apresentações e carrosséis nas marcas marcadas e atualiza as que ele mesmo criou. Não apaga nada
                  e não mexe em peças feitas por você.
                </span>
              </span>
            </label>
          )}
          {wantsEditAll && (
            <label className={styles.option}>
              <input type="radio" name="access" checked={access === 'edit_all'} onChange={() => setAccess('edit_all')} />
              <span className={styles.optionText}>
                <span>Ver e editar todas as peças</span>
                <span className={styles.optionHint}>
                  Além de criar, o agente pode SOBRESCREVER qualquer apresentação ou carrossel das marcas liberadas, mesmo
                  os feitos por você ou pela equipe. A versão anterior fica no histórico da peça e dá para restaurar. Só
                  vale onde você é editor, administrador ou dono. Não apaga nada.
                </span>
              </span>
            </label>
          )}
        </fieldset>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => decide('deny')} disabled={Boolean(sending) || leaving} loading={sending === 'deny'}>
            Recusar
          </Button>
          <Button onClick={() => decide('approve')} disabled={!canApprove} loading={sending === 'approve'}>
            {leaving ? 'Voltando…' : 'Permitir acesso'}
          </Button>
        </div>

        <p className={styles.footer}>
          Você revoga a conexão a qualquer momento em Configurações → Integrações.
        </p>
      </div>
    </main>
  );
}

export default function McpConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentContent />
    </Suspense>
  );
}
