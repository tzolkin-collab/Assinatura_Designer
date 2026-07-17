// Spike PPTX editável — roda o conversor htmlToPptx contra um post REAL do banco.
//
//   npx tsx scripts/pptx-spike.ts [postId] [maxSlides]
//
// Sem postId: pega o post READY mais recente que resolver num deck renderizável
// (html-design OU ir-design — o ir é compilado para HTML pelo renderableDeck,
// então serve de cobaia igual). Se o banco estiver fora, cai num slide sintético
// para validar o conversor mesmo assim.
//
// Saída: pptx-spike-<postId|sintetico>.pptx na pasta do backend + parecer no stdout.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { htmlDocsToPptx } from '../src/lib/htmlToPptx.js';
import { closeBrowser } from '../src/lib/htmlRaster.js';

void config; // garante dotenv carregado antes do prisma

const SYNTHETIC_DOC = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:1080px;height:1080px;overflow:hidden;}
.slide-root{width:1080px;height:1080px;position:relative;overflow:hidden;}
.bg{position:absolute;inset:0;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);}
.card{position:absolute;left:90px;top:280px;width:640px;height:520px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:24px;}
.badge{position:absolute;left:90px;top:120px;width:220px;height:64px;background:#e94560;border-radius:32px;display:flex;align-items:center;justify-content:center;}
.badge span{color:#fff;font-family:Inter,sans-serif;font-size:24px;font-weight:700;letter-spacing:2px;}
h1{position:absolute;left:130px;top:340px;width:560px;color:#ffffff;font-family:'Playfair Display',serif;font-size:88px;line-height:1.1;}
p{position:absolute;left:130px;top:600px;width:520px;color:#c9c9d4;font-family:Inter,sans-serif;font-size:28px;line-height:1.5;}
img.foto{position:absolute;right:60px;top:140px;width:280px;height:280px;border-radius:50%;object-fit:cover;}
.dot{position:absolute;right:120px;bottom:120px;width:120px;height:120px;background:#e94560;border-radius:50%;}
</style></head><body><div class="slide-root">
<div class="bg"></div>
<div class="badge"><span>NOVIDADE</span></div>
<div class="card"></div>
<h1>Design que vende de verdade</h1>
<p>O teste sintético do conversor: texto editável, formas, gradiente, imagem e glassmorphism no mesmo slide.</p>
<img class="foto" src="https://images.unsplash.com/photo-1522199755839-a2bacb67c546?w=600&q=80" alt="">
<div class="dot"></div>
</div></body></html>`;

async function main() {
  const [, , argPostId, argMax] = process.argv;
  const maxSlides = Math.max(1, parseInt(argMax || '5', 10) || 5);

  let docs: string[] = [];
  let width = 1080;
  let height = 1080;
  let label = 'sintetico';
  let kind = 'sintetico';

  try {
    const { default: prisma } = await import('../src/lib/prisma.js');
    const { mergeSlidesIntoPost } = await import('../src/lib/postHelper.js');
    const { resolveRenderableDeck } = await import('../src/lib/renderableDeck.js');

    const candidates = argPostId
      ? await prisma.post.findMany({ where: { id: argPostId }, include: { slides: { orderBy: { position: 'asc' } } } })
      : await prisma.post.findMany({
          where: { status: 'READY' },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { slides: { orderBy: { position: 'asc' } } },
        });

    for (const post of candidates) {
      const content = mergeSlidesIntoPost(post).content;
      const deck = resolveRenderableDeck(content);
      if (!deck) continue;
      width = deck.width;
      height = deck.height;
      const n = Math.min(deck.count, maxSlides);
      docs = Array.from({ length: n }, (_, i) => deck.docAt(i));
      label = post.id.slice(0, 8);
      kind = (content as { kind?: string } | null)?.kind ?? '?';
      console.log(`Post ${post.id} (${kind}, ${deck.count} slides — convertendo ${n}, ${width}x${height}px)`);
      break;
    }
    if (docs.length === 0) console.log('Nenhum post renderizável no banco; usando o slide sintético.');
  } catch (err) {
    console.log(`Banco indisponível (${(err as Error).message.split('\n')[0]}); usando o slide sintético.`);
  }

  if (docs.length === 0) docs = [SYNTHETIC_DOC];

  const t0 = Date.now();
  const { buffer, stats } = await htmlDocsToPptx(docs, width, height, `Spike PPTX ${label}`);
  const ms = Date.now() - t0;

  const outPath = path.resolve(process.cwd(), `pptx-spike-${label}.pptx`);
  fs.writeFileSync(outPath, buffer);

  console.log('\n── Parecer do spike ─────────────────────────────');
  for (const s of stats) {
    console.log(
      `slide ${s.slide}: ${s.texts} textos, ${s.shapes} formas, ${s.images} imagens` +
      (s.svgSkipped ? `, ${s.svgSkipped} SVG ignorados` : '') +
      (s.gradientApprox ? `, ${s.gradientApprox} gradientes aproximados` : ''),
    );
  }
  console.log(`\nArquivo: ${outPath} (${(buffer.length / 1024).toFixed(0)} KB, ${ms}ms)`);
  console.log('Próximo passo manual: importar no Canva (arrastar na home ou POST /url-imports) e comparar com o PNG.');

  await closeBrowser();
  const { default: prisma } = await import('../src/lib/prisma.js').catch(() => ({ default: null as never }));
  await prisma?.$disconnect?.().catch(() => {});
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Spike falhou:', err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
