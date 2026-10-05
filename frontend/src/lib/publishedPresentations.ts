// Regras da tela "Apresentações publicadas", fora do componente para poderem ser testadas.

export type PublishedType = 'CAROUSEL' | 'SINGLE_IMAGE' | 'PRESENTATION';

export interface PublishedCover {
  html: string;
  width: number;
  height: number;
  title: string | null;
}

export interface PublishedPost {
  id: string;
  name: string | null;
  type: PublishedType;
  publicSlug: string;
  publishedAt: string;
  updatedAt: string;
  slideCount: number;
  cover: PublishedCover | null;
}

export const TYPE_LABELS: Record<PublishedType, string> = {
  PRESENTATION: 'Apresentação',
  CAROUSEL: 'Carrossel',
  SINGLE_IMAGE: 'Design',
};

/** Nome da arte; sem nome, o primeiro título do slide; sem isso, um texto honesto. */
export function displayTitle(post: Pick<PublishedPost, 'name' | 'cover'>): string {
  return post.name?.trim() || post.cover?.title?.trim() || 'Apresentação sem título';
}

// Publicar também mexe em `updatedAt`; só conta como edição o que veio bem depois.
const EDIT_GRACE_MS = 2 * 60 * 1000;

/**
 * A arte foi alterada depois de publicada? O link público lê o conteúdo ao vivo, então a
 * versão que as pessoas veem JÁ é a nova: este sinal avisa quem publicou, não é um rascunho.
 */
export function isEditedAfterPublish(post: Pick<PublishedPost, 'publishedAt' | 'updatedAt'>): boolean {
  const published = Date.parse(post.publishedAt);
  const updated = Date.parse(post.updatedAt);
  if (!Number.isFinite(published) || !Number.isFinite(updated)) return false;
  return updated - published > EDIT_GRACE_MS;
}

export function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
}

/** Endereço legível para mostrar na tela: sem o protocolo. */
export function shortPublicUrl(origin: string, publicSlug: string): string {
  const host = origin.replace(/^https?:\/\//, '');
  return `${host}/apresentacao/${publicSlug}`;
}

export type PublishedSort = 'recent' | 'name' | 'edited';

export interface PublishedFilters {
  query: string;
  type: PublishedType | 'ALL';
  sort: PublishedSort;
}

const normalize = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function filterAndSort(posts: PublishedPost[], filters: PublishedFilters): PublishedPost[] {
  const q = normalize(filters.query);
  const filtered = posts.filter((p) => {
    if (filters.type !== 'ALL' && p.type !== filters.type) return false;
    if (!q) return true;
    return normalize(displayTitle(p)).includes(q) || normalize(p.publicSlug).includes(q);
  });
  const byDate = (key: 'publishedAt' | 'updatedAt') => (a: PublishedPost, b: PublishedPost) =>
    Date.parse(b[key]) - Date.parse(a[key]);
  const sorters: Record<PublishedSort, (a: PublishedPost, b: PublishedPost) => number> = {
    recent: byDate('publishedAt'),
    edited: byDate('updatedAt'),
    name: (a, b) => displayTitle(a).localeCompare(displayTitle(b), 'pt-BR'),
  };
  return [...filtered].sort(sorters[filters.sort]);
}

/** Tipos que existem na lista: o filtro só oferece o que tem o que mostrar. */
export function typesPresent(posts: PublishedPost[]): PublishedType[] {
  const present = new Set(posts.map((p) => p.type));
  return (Object.keys(TYPE_LABELS) as PublishedType[]).filter((t) => present.has(t));
}
