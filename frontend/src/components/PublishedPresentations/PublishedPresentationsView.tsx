'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Loader2, Pencil, RefreshCw, Search, X,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
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
  type PublishedType,
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

/** "20 nov 2026": curta o bastante para a meta não quebrar linha; a data longa fica no title. */
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${d.getDate()} ${mes} ${d.getFullYear()}`;
}

const SORT_LABELS: Record<PublishedSort, string> = {
  recent: 'Mais recentes',
  edited: 'Editadas por último',
  name: 'Nome (A–Z)',
};

/**
 * Publicadas: uma linha por link no ar, como a lista de deploys/domínios da Vercel. Antes era
 * uma grade de cartões com selos em cima do slide e um campo de link truncado
 * ("apresentacao/liderar-se…"); o que a tela existe para entregar, o endereço, era o que menos
 * se lia. Agora o endereço aparece inteiro e "Copiar link" é a primeira ação.
 */
export default function PublishedPresentationsView({ slug, posts, loading, error, origin, onRetry, onUnpublish }: ViewProps) {
  const [filters, setFilters] = useState<PublishedFilters>({ query: '', type: 'ALL', sort: 'recent' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
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
      // Sem permissão de área de transferência (comum fora de HTTPS): aparece o campo com o
      // endereço inteiro, já selecionado, para copiar à mão.
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
      <PageHeader
        title="Publicadas"
        description="Links públicos: abrem sem login e mostram sempre a versão mais recente do que está no editor."
      />

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
          <h2 className={styles.listTitle}>
            No ar
            <span className={styles.listCount}>
              {filtering ? `${visible.length} de ${posts.length}` : posts.length}
            </span>
          </h2>

          <div className={styles.toolbarEnd}>
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
              <label className={styles.select}>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as PublishedType | 'ALL' }))}
                  aria-label="Filtrar por tipo"
                >
                  <option value="ALL">Todos os tipos</option>
                  {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            )}

            <label className={styles.select}>
              <select
                value={filters.sort}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as PublishedSort }))}
                aria-label="Ordenar por"
              >
                {(Object.keys(SORT_LABELS) as PublishedSort[]).map((s) => (
                  <option key={s} value={s}>{SORT_LABELS[s]}</option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          </div>
        </div>
      )}

      {loading ? (
        <ul className={styles.list} aria-busy="true" aria-label="Carregando apresentações publicadas">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`${styles.row} ${styles.skeleton}`} aria-hidden="true">
              <div className={styles.skeletonCover} />
              <div className={styles.info}>
                <div className={styles.skeletonLine} style={{ width: '55%', height: 18 }} />
                <div className={styles.skeletonLine} style={{ width: '70%' }} />
                <div className={styles.skeletonLine} style={{ width: '40%' }} />
              </div>
            </li>
          ))}
        </ul>
      ) : posts.length === 0 ? (
        error ? null : (
          <div className={styles.empty}>
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
        <ul className={styles.list}>
          {visible.map((post) => {
            const title = displayTitle(post);
            const edited = isEditedAfterPublish(post);
            const copied = copiedId === post.id;
            const endereco = shortPublicUrl(origin, post.publicSlug);
            return (
              <li key={post.id} className={styles.row}>
                <a href={publicUrl(post)} target="_blank" rel="noreferrer" className={styles.coverLink} aria-label={`Abrir “${title}” em uma nova aba`}>
                  <CoverFrame cover={post.cover} type={post.type} />
                </a>

                <div className={styles.info}>
                  <h3 className={styles.rowTitle} title={title}>{title}</h3>
                  <a href={publicUrl(post)} target="_blank" rel="noreferrer" className={styles.url} title={publicUrl(post)}>
                    {endereco}
                  </a>
                  <p className={styles.meta}>
                    <span>{TYPE_LABELS[post.type]}</span>
                    {post.slideCount > 0 && <span>{post.slideCount} {post.slideCount === 1 ? 'slide' : 'slides'}</span>}
                    <span title={formatPublishedDate(post.publishedAt)}>publicada {formatShortDate(post.publishedAt)}</span>
                  </p>
                  {edited && (
                    <p
                      className={styles.edited}
                      title={`Alterada em ${formatPublishedDate(post.updatedAt)}, depois de publicada. O link já mostra a versão atual.`}
                    >
                      Alterada depois de publicar
                    </p>
                  )}
                  {copyFailedId === post.id && (
                    <div className={styles.copyFallback}>
                      <input
                        className={styles.linkInput}
                        readOnly
                        autoFocus
                        value={publicUrl(post)}
                        aria-label={`Endereço público de ${title}`}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <p className={styles.copyError} role="alert">
                        Não consegui copiar automaticamente. O endereço está selecionado: use Ctrl+C.
                      </p>
                    </div>
                  )}
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
                    onClick={() => copy(post)}
                  >
                    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copied ? 'Copiado' : 'Copiar link'}
                  </button>
                  {/* No celular Abrir e Editar ficam só com o ícone, para as quatro ações caberem numa linha. */}
                  <a href={publicUrl(post)} target="_blank" rel="noreferrer" className={styles.action} aria-label={`Abrir “${title}”`}>
                    <ExternalLink size={14} aria-hidden="true" /> <span className={styles.actionLabel}>Abrir</span>
                  </a>
                  <Link href={`/${slug}/editor/${post.id}`} className={styles.action} aria-label={`Editar “${title}”`}>
                    <Pencil size={14} aria-hidden="true" /> <span className={styles.actionLabel}>Editar</span>
                  </Link>
                  <button type="button" className={`${styles.action} ${styles.actionDanger}`} onClick={() => setConfirming(post)}>
                    {busy && confirming?.id === post.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                    Despublicar
                  </button>
                </div>
                <p className={styles.srOnly} role="status" aria-live="polite">{copied ? 'Link copiado' : ''}</p>
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
