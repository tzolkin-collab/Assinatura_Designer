import { createHash } from 'node:crypto';
import type { Prisma, VersionSource } from '@prisma/client';
import prisma from './prisma.js';
import { mergeSlidesIntoPost, persistPostContent, type PostWithSlides } from './postHelper.js';
import { createError } from '../middleware/errorHandler.js';

/**
 * Histórico do post. O editor já tem undo/redo em memória; ele morre no reload e
 * não protege de nada que a IA escreva no banco. Aqui o estado anterior vira linha.
 */

/** Um deck de 200 slides passa de 2MB por versão: o histórico é curto de propósito. */
export const MAX_VERSIONS_PER_POST = 20;

/** Salvar no editor é frequente. Sem esta janela, o histórico vira uma versão por tecla. */
export const EDITOR_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface SnapshotOptions {
  source: VersionSource;
  label?: string;
  userId?: string;
}

function hashContent(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content ?? null)).digest('hex');
}

function countSlides(content: unknown): number {
  if (typeof content !== 'object' || content === null) return 0;
  const typed = content as { slides?: unknown[]; ir?: { slides?: unknown[] } };
  if (Array.isArray(typed.ir?.slides)) return typed.ir.slides.length;
  if (Array.isArray(typed.slides)) return typed.slides.length;
  return 0;
}

/**
 * Congela o conteúdo ATUAL do post. Chamar ANTES de sobrescrever — depois já é tarde.
 *
 * Devolve `null` quando não havia nada a guardar: post sem conteúdo, conteúdo idêntico
 * à última versão, ou salvamento do editor dentro da janela de debounce.
 */
export async function snapshotPost(postId: string, options: SnapshotOptions) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { slides: true },
  });
  if (!post || !post.content) return null;

  const merged = mergeSlidesIntoPost(post as unknown as PostWithSlides);

  // O merge re-hidrata os slides a partir da tabela relacional e, quando ela está
  // vazia, devolve um deck vazio. Post antigo que guarda os slides só no blob cairia
  // aí: a versão nasceria em branco e "restaurar" apagaria o design. Nesse caso vale
  // o blob, que é onde o trabalho está de verdade.
  const content =
    countSlides(merged.content) === 0 && countSlides(post.content) > 0
      ? post.content
      : merged.content;

  if (!content) return null;

  const contentHash = hashContent(content);

  const latest = await prisma.postVersion.findFirst({
    where: { postId },
    orderBy: { createdAt: 'desc' },
    select: { contentHash: true, createdAt: true },
  });

  // Nada mudou desde a última versão: gravar de novo só gastaria espaço.
  if (latest?.contentHash === contentHash) return null;

  // O editor salva a cada alteração; só marcamos um ponto a cada janela. Snapshot
  // manual, da IA ou de restauração é sempre um "passo grande" e nunca é engolido.
  if (options.source === 'EDITOR' && latest) {
    const idade = Date.now() - latest.createdAt.getTime();
    if (idade < EDITOR_SNAPSHOT_INTERVAL_MS) return null;
  }

  const version = await prisma.postVersion.create({
    data: {
      postId,
      content: content as Prisma.InputJsonValue,
      contentHash,
      label: options.label?.slice(0, 160) ?? null,
      source: options.source,
      slideCount: countSlides(content),
      createdById: options.userId ?? null,
    },
    select: { id: true, label: true, source: true, slideCount: true, createdAt: true },
  });

  await pruneVersions(postId);
  return version;
}

/** Mantém só as `MAX_VERSIONS_PER_POST` mais recentes. */
async function pruneVersions(postId: string): Promise<void> {
  const excedentes = await prisma.postVersion.findMany({
    where: { postId },
    orderBy: { createdAt: 'desc' },
    skip: MAX_VERSIONS_PER_POST,
    select: { id: true },
  });
  if (excedentes.length === 0) return;

  await prisma.postVersion.deleteMany({
    where: { id: { in: excedentes.map(v => v.id) } },
  });
}

/**
 * Volta o post para uma versão. O estado atual vira uma versão antes de ser
 * sobrescrito — restaurar por engano não pode ser um caminho sem volta.
 */
export async function restorePostVersion(postId: string, versionId: string, userId?: string) {
  const version = await prisma.postVersion.findFirst({
    where: { id: versionId, postId }, // amarrado ao post: id de versão de outro post não serve
    select: { id: true, content: true, createdAt: true },
  });
  if (!version) throw createError(404, 'Versão não encontrada para este post.');

  await snapshotPost(postId, {
    source: 'RESTORE',
    label: `Antes de restaurar a versão de ${version.createdAt.toLocaleString('pt-BR')}`,
    userId,
  });

  await persistPostContent(postId, version.content);

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { slides: true },
  });
  return mergeSlidesIntoPost(post as unknown as PostWithSlides);
}
