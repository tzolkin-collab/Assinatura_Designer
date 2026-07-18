// Migra os posts ir-design legados para html-design (decisão 2026-07-18:
// html-design é o ÚNICO formato do produto; o editor IR será removido).
//
//   npx tsx scripts/migrate-ir-to-html.ts          → dry-run (mostra o que faria)
//   npx tsx scripts/migrate-ir-to-html.ts --apply  → migra de verdade
//
// Cada slide IR é compilado pelo compileSlide (o MESMO compilador que sempre
// gerou o PNG/preview desses posts — fidelidade idêntica à que o usuário vê).
// Um PostVersion é snapshotado antes de cada migração: o caminho de volta existe.

import { config } from '../src/config.js';
import prisma from '../src/lib/prisma.js';
import { mergeSlidesIntoPost, persistPostContent } from '../src/lib/postHelper.js';
import { snapshotPost } from '../src/lib/postVersions.js';
import { compileSlide } from '../src/lib/designIR/compiler.js';
import type { SlideNode } from '../src/lib/designIR/types.js';

void config;

const APPLY = process.argv.includes('--apply');

async function main() {
  const posts = await prisma.post.findMany({ include: { slides: { orderBy: { position: 'asc' } } } });
  let migrados = 0;
  let pulados = 0;

  for (const post of posts) {
    const content = mergeSlidesIntoPost(post).content as unknown as {
      kind?: string;
      width?: number;
      height?: number;
      format?: string;
      fonts?: string[];
      reasoning?: string;
      sessionId?: string;
      chatHistory?: unknown;
      ir?: { width?: number; height?: number; fonts?: string[]; slides?: SlideNode[] };
    } | null;

    if (content?.kind !== 'ir-design' || !Array.isArray(content.ir?.slides) || content.ir!.slides!.length === 0) {
      if (content?.kind !== 'html-design') pulados++;
      continue;
    }

    const ir = content.ir!;
    const width = ir.width ?? content.width ?? 1080;
    const height = ir.height ?? content.height ?? 1080;
    const fonts = ir.fonts ?? content.fonts ?? ['Inter'];

    const slides = ir.slides!.map((s) => {
      const { html, css } = compileSlide(s, undefined, fonts);
      return { html, css: css || undefined };
    });

    const novoContent = {
      kind: 'html-design' as const,
      version: 1 as const,
      source: 'migrated-from-ir' as const,
      width,
      height,
      format: (content.format ?? 'presentation') as 'single' | 'carousel' | 'story' | 'presentation',
      fonts,
      slides,
      reasoning: content.reasoning,
      ...(content.sessionId ? { sessionId: content.sessionId } : {}),
      ...(content.chatHistory ? { chatHistory: content.chatHistory } : {}),
    };

    console.log(`${APPLY ? 'MIGRANDO' : '[dry-run]'} ${post.id.slice(0, 8)} — ${slides.length} slides ir-design → html-design`);

    if (APPLY) {
      await snapshotPost(post.id, { source: 'MANUAL', label: 'Antes da migração ir-design → html-design' });
      await persistPostContent(post.id, novoContent);
      migrados++;
    }
  }

  console.log(`\n${APPLY ? `${migrados} posts migrados` : 'dry-run concluído'} (${pulados} não-migráveis ignorados).`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('erro:', (e as Error).message); process.exit(1); });
