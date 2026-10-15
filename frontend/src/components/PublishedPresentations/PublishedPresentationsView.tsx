'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Check, Copy, ExternalLink, Info, Loader2, MonitorPlay, Pencil, RefreshCw, Search, X,
} from 'lucide-react';
import CoverFrame from './CoverFrame';
import UnpublishDialog from './UnpublishDialog';
import {
  TYPE_LABELS,
  displayTitle,
  filterAndSort,
  formatPublishedDate,
  isEditedAfterPublish,
  shortPublicUrl,
  typesPresent,
  type PublishedFilters,
  type PublishedPost,
  type PublishedSort,
} from '@/lib/publishedPresentations';
import styles from './PublishedPresentations.module.css';

interface ViewProps {
  slug: string;
  posts: PublishedPost[];
  loading: boolean;
  error: string;
  /** Endereço do app, para montar o link público. Vazio no servidor: só é usado depois de carregar. */
  origin: string;
  onRetry: () => void;
  /** Despublica; lança em caso de falha (a página mostra o erro). */
  onUnpublish: (post: PublishedPost) => Promise<void>;
}

const SORT_LABELS: Record<PublishedSort, string> = {
  recent: 'Mais recentes',
  edited: 'Editadas por último',
  name: 'Nome (A–Z)',
};

export default function PublishedPresentationsView({ slug, posts, loading, error, origin, onRetry, onUnpublish }: ViewProps) {
  const [filters, setFilters] = useState<PublishedFilters>({ query: '', type: 'ALL', sort: 'recent' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PublishedPost | null>(null);
  const [busy, setBusy] = useState(false);

  const publicUrl = (p: PublishedPost) => `${origin}/apresentacao/${p.publicSlug}`;
  const visible = filterAndSort(posts, filters);
  const types = typesPresent(posts);
  const filtering = filters.query.trim() !== '' || filters.type !== 'ALL';

  const copy = async (post: PublishedPost) => {
    setCopyFailedId(null);
    try {
      await navigator.clipboard.writeText(publicUrl(post));
      setCopiedId(post.id);
      setTimeout(() => setCopiedId((id) => (id === post.id ? null : id)), 2000);
    } catch {
      // Sem permissão de área de transferência (comum fora de HTTPS): o campo do endereço é
      // selecionável, então a pessoa ainda consegue copiar à mão.
      setCopyFailedId(post.id);
    }
  };

  const confirmUnpublish = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      await onUnpublish(confirming);
      setConfirming(null);
    } catch {
      // A página já mostra o erro no topo; fecha o diálogo para ele ficar visível.
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Apresentações publicadas</h1>
          <p className={styles.subtitle}>
            Páginas públicas com link: qualquer pessoa com o endereço acessa, sem login.
          </p>
        </div>
        {!loading && posts.length > 0 && (
          <span className={styles.count} aria-label={`${posts.length} publicadas`}>
            <MonitorPlay size={14} aria-hidden="true" />
            {posts.length} {posts.length === 1 ? 'publicada' : 'publicadas'}
          </span>
        )}
      </header>

      {!loading && posts.length > 0 && (
        <p className={styles.note}>
          <Info size={15} aria-hidden="true" />
          <span>
            O endereço público sempre mostra a <strong>versão mais recente</strong> da arte: o que você
            altera no editor já está no ar, sem precisar publicar de novo.
          </span>
        </p>
      )}

      {error && (
        <div className={styles.errorBox} role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className={styles.errorRetry} onClick={onRetry}>
            <RefreshCw size={13} aria-hidden="true" /> Tentar de novo
          </button>
        </div>
      )}

      {!loading && posts.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar por nome ou endereço"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              aria-label="Buscar apresentações"
            />
          </label>

          {types.length > 1 && (
            <div className={styles.chips} role="group" aria-label="Filtrar por tipo">
              {(['ALL', ...types] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.chip} ${filters.type === t ? styles.chipActive : ''}`}
                  aria-pressed={filters.type === t}
                  onClick={() => setFilters((f) => ({ ...f, type: t }))}
                >
                  {t === 'ALL' ? 'Todas' : TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          )}

          <label className={styles.sort}>
            <span className={styles.srOnly}>Ordenar por</span>
            <select
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as PublishedSort }))}
            >
              {(Object.keys(SORT_LABELS) as PublishedSort[]).map((s) => (
                <option key={s} value={s}>{SORT_LABELS[s]}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {loading ? (
        <div className={styles.grid} aria-busy="true" aria-label="Carregando apresentações publicadas">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true">
              <div className={styles.skeletonCover} />
              <div className={styles.skeletonBody}>
                <div className={styles.skeletonLine} style={{ width: '70%' }} />
                <div className={styles.skeletonLine} style={{ width: '45%' }} />
                <div className={styles.skeletonLine} style={{ height: 36 }} />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        error ? null : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><MonitorPlay size={26} aria-hidden="true" /></div>
            <h2 className={styles.emptyTitle}>Nenhuma apresentação publicada ainda</h2>
            <p className={styles.emptyText}>
              Publique uma apresentação para gerar um link que qualquer pessoa abre no navegador,
              sem precisar de conta.
            </p>
            <ol className={styles.emptySteps}>
              <li>Abra uma apresentação na Fábrica.</li>
              <li>No painel da arte, use <strong>Hospedar</strong>.</li>
              <li>Copie o link e envie.</li>
            </ol>
            <Link href={`/${slug}/fabrica`} className={styles.btnPrimary}>Ir para a Fábrica</Link>
          </div>
        )
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>Nada encontrado</h2>
          <p className={styles.emptyText}>
            Nenhuma apresentação combina com {filters.query.trim() ? <>“<strong>{filters.query.trim()}</strong>”</> : 'este filtro'}.
          </p>
          {filtering && (
            <button type="button" className={styles.btnSecondary} onClick={() => setFilters((f) => ({ ...f, query: '', type: 'ALL' }))}>
              <X size={14} aria-hidden="true" /> Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <ul className={styles.grid}>
          {visible.map((post) => {
            const title = displayTitle(post);
            const edited = isEditedAfterPublish(post);
            const copied = copiedId === post.id;
            return (
              <li key={post.id} className={styles.card}>
                <a href={publicUrl(post)} target="_blank" rel="noreferrer" className={styles.coverLink} aria-label={`Abrir “${title}” em uma nova aba`}>
                  <CoverFrame cover={post.cover} type={post.type} />
                  <span className={styles.coverBadge}>{TYPE_LABELS[post.type]}</span>
                  {post.slideCount > 0 && (
                    <span className={styles.coverCount}>{post.slideCount} {post.slideCount === 1 ? 'slide' : 'slides'}</span>
                  )}
                </a>

                <div className={styles.body}>
                  <h2 className={styles.cardTitle} title={title}>{title}</h2>
                  <p className={styles.meta}>
                    <span>Publicada em {formatPublishedDate(post.publishedAt)}</span>
                    {edited && (
                      <span
                        className={styles.edited}
                        title={`Alterada em ${formatPublishedDate(post.updatedAt)}, depois de publicada. O link já mostra a versão atual.`}
                      >
                        Alterada depois
                      </span>
                    )}
                  </p>

                  <div className={styles.linkRow}>
                    <input
                      className={styles.linkInput}
                      readOnly
                      // O host é igual em todos os cartões; o que distingue é o final. Com o campo em foco
                      // (ou se a cópia automática falhar) mostra o endereço inteiro, pronto para copiar.
                      value={focusedId === post.id || copyFailedId === post.id
                        ? shortPublicUrl(origin, post.publicSlug)
                        : `apresentacao/${post.publicSlug}`}
                      title={publicUrl(post)}
                      aria-label={`Endereço público de ${title}`}
                      onFocus={(e) => { setFocusedId(post.id); requestAnimationFrame(() => e.currentTarget.select()); }}
                      onBlur={() => setFocusedId((id) => (id === post.id ? null : id))}
                    />
                    <button
                      type="button"
                      className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
                      onClick={() => copy(post)}
                    >
                      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p className={styles.srOnly} role="status" aria-live="polite">{copied ? 'Link copiado' : ''}</p>
                  {copyFailedId === post.id && (
                    <p className={styles.copyError} role="alert">
                      Não consegui copiar automaticamente. Selecione o endereço acima e use Ctrl+C.
                    </p>
                  )}

                  <div className={styles.actions}>
                    <a href={publicUrl(post)} target="_blank" rel="noreferrer" className={styles.action}>
                      <ExternalLink size={14} aria-hidden="true" /> Abrir
                    </a>
                    <Link href={`/${slug}/editor/${post.id}`} className={styles.action}>
                      <Pencil size={14} aria-hidden="true" /> Editar
                    </Link>
                    <button type="button" className={`${styles.action} ${styles.actionDanger}`} onClick={() => setConfirming(post)}>
                      {busy && confirming?.id === post.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                      Despublicar
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirming && (
        <UnpublishDialog
          title={displayTitle(confirming)}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={confirmUnpublish}
        />
      )}
    </div>
  );
}
