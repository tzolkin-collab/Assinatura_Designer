import type { Prisma, VersionSource } from '@prisma/client';
import prisma from './prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { buildSlideDocument, sanitizeSlideCss, sanitizeSlideHtml } from './htmlDesign.js';
import { analyzePhoto, frameFromAnalysis, measureSlotAspect } from './photoFraming.js';
import { PhotoSlotNotFoundError, listPhotoSlots, setPhotoInSlot, type PhotoSlotInfo } from './photoSlot.js';
import { mergeSlidesIntoPost, type PostWithSlides } from './postHelper.js';
import { snapshotPost } from './postVersions.js';

/**
 * Coloca, troca, reenquadra ou esvazia a foto de um espaço (`<div data-photo-slot>`) de um slide.
 * Compartilhada pela rota do editor (`PUT /posts/:id/slides/:index/photo`) e pela ferramenta MCP `set_slide_photo`.
 * Nenhuma chamada de modelo, nenhuma geração: só arquivo real da biblioteca da marca.
 *
 * Autorização (quem pode editar este post) é de quem chama.
 */
export interface ApplySlidePhotoInput {
  postId: string;
  /** Posição do slide, a partir de 0. */
  index: number;
  slot: string;
  /** string = coloca/troca; null = esvazia o espaço; ausente = só muda o enquadramento da foto atual. */
  assetUrl?: string | null;
  position?: { x: number; y: number };
  fit?: 'cover' | 'contain';
  userId?: string;
  source: VersionSource;
  /**
   * Bibliotecas de onde a foto pode vir. Padrão: só a da marca do post. O MCP acrescenta a do projeto-base de um
   * collab, que `list_assets` oferece.
   */
  allowedBrandIds?: string[];
}

export type PhotoFraming = { mode: 'manual' | 'kept' | 'auto' | 'center'; faceVisible?: number | null };

export interface AppliedPhoto {
  slideIndex: number;
  slide: { html: string; css?: string };
  slots: PhotoSlotInfo[];
  framing: PhotoFraming;
}

type HtmlSlideContent = {
  kind?: string;
  width?: number;
  height?: number;
  fonts?: string[];
  slides?: Array<{ html: string; css?: string }>;
};

export async function applySlidePhoto(input: ApplySlidePhotoInput): Promise<AppliedPhoto> {
  const { postId, index: idx, slot } = input;

  const post = await prisma.post.findFirst({
    where: { id: postId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) throw createError(404, 'Post não encontrado');

  const content = mergeSlidesIntoPost(post as unknown as PostWithSlides).content as unknown as HtmlSlideContent;
  if (content?.kind !== 'html-design' || !Array.isArray(content.slides)) {
    throw createError(400, 'Troca de foto disponível apenas para designs html-design');
  }
  const current = content.slides[idx];
  if (!current) throw createError(400, 'slide fora do limite');

  const atual = listPhotoSlots(current.html).find((s) => s.slot === slot);

  let placement: Parameters<typeof setPhotoInSlot>[2];
  // Como o enquadramento foi decidido: a tela usa para avisar a pessoa.
  let framing: PhotoFraming = { mode: 'manual' };
  if (input.assetUrl === null) {
    placement = null;
  } else if (typeof input.assetUrl === 'string') {
    // Só foto da biblioteca DESTA marca. Sem isto, o cliente poderia mandar qualquer URL
    // e o chromium do raster iria buscá-la (SSRF), além de poder expor foto de outra marca.
    const asset = await prisma.asset.findFirst({
      where: {
        brandId: input.allowedBrandIds ? { in: input.allowedBrandIds } : post.brandId,
        url: input.assetUrl,
        fileType: { startsWith: 'image/' },
      },
      select: { name: true },
    });
    if (!asset) throw createError(400, 'Essa foto não está na biblioteca da marca');
    // A mesma foto reenviada mantém o enquadramento que já tinha; a pessoa que escolhe a posição
    // manda. Foto NOVA é enquadrada pelo assunto (rosto/pessoa/objeto) em vez de pelo centro:
    // o centro cortava a cabeça em retratos com o rosto no terço de cima. Se não der para
    // detectar ou medir, volta ao centro, como antes.
    const mesmaFoto = atual?.src === input.assetUrl;
    let position = input.position ?? (mesmaFoto ? atual!.position : { x: 50, y: 50 });
    framing = input.position ? { mode: 'manual' } : mesmaFoto ? { mode: 'kept' } : { mode: 'center' };
    if (!input.position && !mesmaFoto) {
      const doc = buildSlideDocument(current, content.fonts ?? ['Inter'], content.width ?? 1080, content.height ?? 1080);
      const [analysis, aspect] = await Promise.all([
        analyzePhoto(input.assetUrl),
        measureSlotAspect(doc, { width: content.width ?? 1080, height: content.height ?? 1080 }, slot),
      ]);
      const auto = frameFromAnalysis(analysis, aspect);
      if (auto) {
        position = auto.position;
        framing = { mode: 'auto', faceVisible: auto.faceVisible };
      }
    }
    placement = {
      url: input.assetUrl,
      position,
      fit: input.fit ?? atual?.fit,
      alt: asset.name,
    };
  } else {
    // Só enquadramento: mantém a foto e o ajuste que já estão no espaço.
    if (!atual?.src) throw createError(400, 'Não há foto neste espaço para reenquadrar');
    placement = { url: atual.src, position: input.position ?? atual.position, fit: input.fit ?? atual.fit };
  }

  let novoHtml: string;
  try {
    novoHtml = setPhotoInSlot(current.html, slot, placement);
  } catch (e) {
    if (e instanceof PhotoSlotNotFoundError) throw createError(404, e.message);
    throw e;
  }

  // Mesma porta de escrita da edição de código: sanitiza no servidor e snapshota antes.
  const clean = { html: sanitizeSlideHtml(novoHtml), css: current.css ? sanitizeSlideCss(current.css) : undefined };
  if (!clean.html.trim()) throw createError(400, 'html ficou vazio após a sanitização');

  const row = post.slides.find((s) => s.position === idx);
  if (!row) throw createError(404, 'Slide não encontrado na tabela relacional');

  await snapshotPost(post.id, {
    source: input.source,
    label: input.assetUrl === null ? `Antes de remover a foto do slide ${idx + 1}` : `Antes de trocar a foto do slide ${idx + 1}`,
    userId: input.userId,
  });
  await prisma.slide.update({
    where: { id: row.id },
    data: {
      contentJson: clean as unknown as Prisma.InputJsonValue,
      htmlRender: buildSlideDocument(clean, content.fonts ?? ['Inter'], content.width ?? 1080, content.height ?? 1080),
    },
  });
  await prisma.post.update({ where: { id: post.id }, data: { updatedAt: new Date() } });

  return { slideIndex: idx, slide: clean, slots: listPhotoSlots(clean.html), framing };
}
