import type { Prisma } from '@prisma/client';

/**
 * Lista leve de posts para a Galeria (`GET /brands/:slug/posts?view=gallery`).
 *
 * A lista completa devolve, de cada post, todos os slides e o `content` inteiro. No `content`
 * moram `chatHistory` (conversa da Fábrica, com anexos: 4 MB num post só), `usedAssets` e
 * `reasoning`. A Galeria só precisa da capa, da contagem de slides e do suficiente para
 * decidir filtros e ações. O resto o preview busca em `GET /posts/:id` quando é aberto.
 */

/** Campos do `content` que a lista NÃO leva. Qualquer mudança aqui muda o contrato da rota. */
export const GALLERY_STRIPPED_CONTENT_KEYS = ['slides', 'chatHistory', 'usedAssets', 'reasoning'] as const;

/** Linha da consulta que já tira esses campos no banco (o JSON pesado nem sai do Postgres). */
export interface GalleryContentRow {
  id: string;
  /** `content` sem os campos acima. */
  content: Prisma.JsonValue | null;
  /** Primeiro slide quando o deck antigo guarda os slides só no blob (sem linhas em `slides`). */
  blobFirstSlide: Prisma.JsonValue | null;
  blobSlideCount: number | bigint | null;
  chatCount: number | bigint | null;
}

/** Subconjunto de uma linha de `Post` (com relações) que a lista usa. */
export interface GalleryPostInput {
  id: string;
  slides: Array<{ id: string; contentJson: Prisma.JsonValue; metadata: Prisma.JsonValue | null }>;
  _count: { slides: number };
  [key: string]: unknown;
}

export interface GalleryPost extends Record<string, unknown> {
  id: string;
  /** Marca a lista como parcial: o cliente busca o post completo antes de abrir preview/histórico. */
  light: true;
  slideCount: number;
  hasChatHistory: boolean;
  content: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toNumber = (v: number | bigint | null | undefined): number => (v == null ? 0 : Number(v));

export function toGalleryPost(post: GalleryPostInput, row: GalleryContentRow | undefined): GalleryPost {
  const { slides, _count, ...rest } = post;

  // Mesma forma que mergeSlidesIntoPost dá a cada slide (conteúdo + id da linha + metadata),
  // para o cliente tratar a capa da lista e o slide do post completo do mesmo jeito.
  const first = slides[0];
  const firstRelational = first
    ? { ...(isRecord(first.contentJson) ? first.contentJson : {}), id: first.id, metadata: first.metadata || undefined }
    : null;
  const firstSlide = firstRelational ?? row?.blobFirstSlide ?? null;
  const slideCount = _count.slides > 0 ? _count.slides : toNumber(row?.blobSlideCount);

  let content: unknown = row?.content ?? null;
  // Só deck de slides tem a capa embutida; ir-design e imagem seguem como estão, sem os campos pesados.
  if (isRecord(content) && content.kind !== 'ir-design' && firstSlide !== null) {
    content = { ...content, slides: [firstSlide] };
  }

  return {
    ...rest,
    id: post.id,
    light: true,
    slideCount,
    hasChatHistory: toNumber(row?.chatCount) > 0,
    content,
  };
}
