// Export do deck INTEIRO como arquivo: PDF (uma página por slide) ou ZIP de PNGs.
//
// Até aqui o deck só saía do sistema em pedaços: um PNG por request (`/export?slide=N`)
// ou rasterizado dentro do Canva. Quem precisava levar a apresentação para uma reunião
// não tinha arquivo — tinha preview. É este módulo que fecha esse buraco.
//
// Duas decisões que valem explicação:
//
// 1. PDF por PRINT, não por screenshot. O mesmo documento HTML vai ao mesmo chromium,
//    mas por `page.pdf()` em vez de `page.screenshot()`. O texto continua texto: nítido
//    em qualquer zoom e selecionável — ao contrário do export para o Canva, que sobe o
//    slide como imagem e transforma cada letra em pixel.
//
// 2. Um documento isolado por slide, depois merge com pdf-lib. Concatenar os N slides
//    num único HTML seria um render só, mas o CSS de um slide vazaria no outro (o
//    `docAt` devolve documentos completos, com regras globais). Render por slide custa
//    mais tempo e não custa correção.
//
// A renderização é SEQUENCIAL de propósito: o gargalo é o chromium (o cluster do
// `htmlRaster` já limita concorrência pela memória da máquina), e disparar 200 slides
// de uma vez encheria a RAM de buffers full-res esperando a vez. Sequencial mantém a
// memória plana e o progresso honesto.

// archiver 8 é ESM puro: não existe mais a função `archiver('zip', ...)` — só as
// classes. Instanciar direto a ZipArchive é o caminho suportado hoje.
import { ZipArchive } from 'archiver';
import { PDFDocument } from 'pdf-lib';
import prisma from './prisma.js';
import { mergeSlidesIntoPost } from './postHelper.js';
import { resolveRenderableDeck, type RenderableDeck } from './renderableDeck.js';
import { renderHtmlToPng, renderHtmlToPdf } from './htmlRaster.js';
import { htmlDocsToPptx } from './htmlToPptx.js';
import { uploadFileToR2 } from './r2.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from './logger.js';

export type DeckExportFormat = 'pdf' | 'zip' | 'pptx' | 'html';

const MIME_BY_FORMAT: Record<DeckExportFormat, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'application/zip',
};

const EXT_BY_FORMAT: Record<DeckExportFormat, string> = {
  pdf: 'pdf',
  zip: 'png',
  pptx: 'pptx',
  html: 'zip',
};

export interface DeckExportParams {
  postId: string;
  /** Dono do pedido: o worker não sabe quem pediu, e o progresso não pode vazar. */
  userId: string;
  format: DeckExportFormat;
}

export interface DeckExportResult {
  url: string;
  fileName: string;
  format: DeckExportFormat;
  slides: number;
}

export type OnDeckProgress = (done: number, total: number) => Promise<void> | void;

/**
 * Carrega o deck renderizável do post. Funciona com um deck em GERAÇÃO: os slides
 * já prontos estão na tabela relacional e o `mergeSlidesIntoPost` remonta o IR a
 * partir dela — quem exporta no meio do caminho leva o que já existe.
 */
async function carregarDeck(postId: string): Promise<{ deck: RenderableDeck; titulo: string }> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!post) throw createError(404, 'Post não encontrado');

  const deck = resolveRenderableDeck(mergeSlidesIntoPost(post).content);
  if (!deck) {
    throw createError(400, 'Export disponível apenas para designs html-design ou ir-design');
  }
  if (deck.count === 0) throw createError(400, 'Este design ainda não tem slides.');

  const titulo = (post.name || `deck-${postId.slice(0, 8)}`).replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);
  return { deck, titulo };
}

async function exportarPdf(deck: RenderableDeck, onProgress?: OnDeckProgress): Promise<Buffer> {
  const documento = await PDFDocument.create();

  for (let i = 0; i < deck.count; i++) {
    const pdfDoSlide = await renderHtmlToPdf(deck.docAt(i), { width: deck.width, height: deck.height });
    const origem = await PDFDocument.load(pdfDoSlide);
    const [pagina] = await documento.copyPages(origem, [0]);
    documento.addPage(pagina!);

    await onProgress?.(i + 1, deck.count);
  }

  return Buffer.from(await documento.save());
}

async function exportarZip(deck: RenderableDeck, onProgress?: OnDeckProgress): Promise<Buffer> {
  // `store: true`: PNG já é comprimido; recomprimir só queima CPU para ganhar ~0%.
  const zip = new ZipArchive({ store: true });
  const pedacos: Buffer[] = [];

  zip.on('data', (c: Buffer) => pedacos.push(c));
  const fechado = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve());
    zip.on('error', reject);
  });

  const largura = String(deck.count).length;
  for (let i = 0; i < deck.count; i++) {
    const png = await renderHtmlToPng(deck.docAt(i), { width: deck.width, height: deck.height, maxDim: 0 });
    zip.append(png, { name: `slide-${String(i + 1).padStart(largura, '0')}.png` });

    await onProgress?.(i + 1, deck.count);
  }

  await zip.finalize();
  await fechado;

  return Buffer.concat(pedacos);
}

async function exportarHtml(deck: RenderableDeck, onProgress?: OnDeckProgress): Promise<Buffer> {
  // O HTML comprime muito bem, então store: false para usar compressão do archiver
  const zip = new ZipArchive({ store: false });
  const pedacos: Buffer[] = [];

  zip.on('data', (c: Buffer) => pedacos.push(c));
  const fechado = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve());
    zip.on('error', reject);
  });

  const largura = String(deck.count).length;
  for (let i = 0; i < deck.count; i++) {
    const htmlDoc = deck.docAt(i);
    zip.append(htmlDoc, { name: `slide-${String(i + 1).padStart(largura, '0')}.html` });

    await onProgress?.(i + 1, deck.count);
  }

  await zip.finalize();
  await fechado;

  return Buffer.concat(pedacos);
}

/**
 * Roda o export e devolve a URL do arquivo no R2. O arquivo sobe para o storage em
 * vez de voltar na resposta porque quem pede é um job: o cliente faz polling e só
 * quer, no fim, um link para baixar (um PDF de 200 slides não pode viver na memória
 * do processo entre um request e outro).
 */
export async function runDeckExport(
  params: DeckExportParams,
  onProgress?: OnDeckProgress,
): Promise<DeckExportResult> {
  const { postId, format } = params;
  const { deck, titulo } = await carregarDeck(postId);

  logger.info('Export de deck iniciado', { postId, format, slides: deck.count });

  let buffer: Buffer;
  if (format === 'pdf') {
    buffer = await exportarPdf(deck, onProgress);
  } else if (format === 'zip') {
    buffer = await exportarZip(deck, onProgress);
  } else if (format === 'html') {
    buffer = await exportarHtml(deck, onProgress);
  } else {
    // PPTX editável: scan de DOM → elementos nativos (texto continua texto).
    const docs = Array.from({ length: deck.count }, (_, i) => deck.docAt(i));
    const { buffer: pptxBuffer, stats } = await htmlDocsToPptx(docs, deck.width, deck.height, titulo, onProgress);
    logger.info('PPTX gerado', { postId, slides: stats.length, stats });
    buffer = pptxBuffer;
  }

  const ext = EXT_BY_FORMAT[format];
  const fileName = format === 'zip' ? `${titulo}-png.${ext}` : format === 'html' ? `${titulo}-html.${ext}` : `${titulo}.${ext}`;
  const url = await uploadFileToR2(buffer, fileName, MIME_BY_FORMAT[format], 'exports');

  logger.info('Export de deck concluído', { postId, format, slides: deck.count, bytes: buffer.length });

  return { url, fileName, format, slides: deck.count };
}
