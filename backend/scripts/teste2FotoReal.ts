// Teste 2 do Cérebro de IA (§14): "Slide com foto real".
//
//   pnpm exec tsx scripts/teste2FotoReal.ts --out "<pasta para os PNGs>"
//
// Gera um deck de 3 slides para a Amanda com o texto aprovado e a instrução de usar as fotos reais da
// biblioteca, e confere cada critério mensurável (usa a foto, nada gerado por IA, nada de fora da
// biblioteca, foto não alterada, enquadrada pelo rosto). O que só um olho julga sai como "manual".
// ATENÇÃO: roda a geração de verdade (Gemini), cerca de US$ 0,50. Sai com código 1 se algum critério falhar.
import 'dotenv/config';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { createSession, getSession } from '../src/lib/redis.js';
import { runPipeline } from '../src/agents/pipeline.js';
import { buildSlideDocument } from '../src/lib/htmlDesign.js';
import { renderHtmlToBase64, closeBrowser } from '../src/lib/htmlRaster.js';
import { acceptancePassed, evaluateRealPhotoRun } from '../src/lib/designerBrain/photoAcceptance.js';
import { NON_PHOTO_ASSET_TAGS } from '../src/lib/designerBrain/referenceTags.js';

const SLUG = 'amanda-coelho';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;

// Texto aprovado neutro: não afirma nada sobre a Amanda além do que já está no documento da Gabriela.
const COPY = `Estratégia para uma vida mais extraordinária
Uma forma de pensar negócios, carreira e escolhas com clareza, repertório e coragem.

Todo resultado começa em uma decisão
Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir?

O próximo passo é uma boa conversa
Se faz sentido pensar o seu momento com mais método e mais coragem, o primeiro movimento é simples: sentar, olhar o cenário e decidir juntos por onde começar.`;

const BRIEF =
  'Apresentação de 3 slides com o texto aprovado fornecido, na ordem, um bloco por slide. ' +
  'Use as fotos reais da biblioteca do projeto onde fizer sentido, principalmente na capa.';

const ICON = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const marca = { pass: `${ICON.green}PASSA${ICON.reset}`, fail: `${ICON.red}FALHA${ICON.reset}`, warn: `${ICON.yellow}ALERTA${ICON.reset}`, manual: `${ICON.cyan}MANUAL${ICON.reset}` };

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!brand) throw new Error(`Projeto "${SLUG}" não existe neste banco.`);

  const assets = await prisma.asset.findMany({
    where: { brandId: brand.id, fileType: { startsWith: 'image/' } },
    select: { url: true, name: true, source: true, tags: true },
  });
  const libraryUrls = new Set(assets.map((a) => a.url));
  const photos = assets.filter((a) => ['upload', 'drive', 'asana'].includes(a.source) && !a.tags.some((t) => (NON_PHOTO_ASSET_TAGS as readonly string[]).includes(t)));

  if (photos.length === 0) {
    const r = evaluateRealPhotoRun({ slides: [], photos: [], libraryUrls, generatedAssets: 0 });
    console.log(`${marca[r[0]!.status]} ${r[0]!.label}: ${r[0]!.detail}`);
    console.log('Suba as fotos com scripts/loadAmandaPhotos.ts e rode de novo. Nada foi gerado.');
    process.exit(1);
  }
  console.log(`${photos.length} foto(s) real(is) na biblioteca. Gerando (Gemini real)...`);

  const sessionId = randomUUID();
  const postId = randomUUID();
  await createSession(sessionId, SLUG, undefined, 'auto');
  const t0 = Date.now();
  await runPipeline({ sessionId, postId, brief: BRIEF, format: 'presentation', sourceCopy: COPY });
  const s = await getSession(sessionId);
  console.log(`Geração concluída em ${Math.round((Date.now() - t0) / 1000)}s (fase: ${s?.phase}).`);

  const post = await prisma.post.findUnique({ where: { id: postId } });
  const content = post?.content as { width: number; height: number; fonts?: string[] } | undefined;
  const rows = await prisma.slide.findMany({ where: { postId }, orderBy: { position: 'asc' } });
  const slides = rows.map((r) => ({ html: String((r.contentJson as { html?: string }).html ?? ''), css: (r.contentJson as { css?: string }).css }));
  const generatedAssets = await prisma.asset.count({ where: { postId } });

  const results = evaluateRealPhotoRun({ slides, photos, libraryUrls, generatedAssets });
  console.log(`\nTeste 2: slide com foto real (deck ${postId})`);
  for (const r of results) console.log(`  ${marca[r.status]}  ${r.label}\n         ${r.detail}`);

  if (out && content) {
    fs.mkdirSync(out, { recursive: true });
    for (const [i, sl] of slides.entries()) {
      const doc = buildSlideDocument(sl, content.fonts ?? ['Inter'], content.width, content.height);
      fs.writeFileSync(`${out}/teste2-slide-${i + 1}.png`, Buffer.from(await renderHtmlToBase64(doc, { width: content.width, height: content.height, maxDim: 1280 }), 'base64'));
    }
    console.log(`\nSlides renderizados em ${out}. Abra os que têm foto e confira o critério MANUAL.`);
  }
  await closeBrowser().catch(() => {});
  process.exit(acceptancePassed(results) ? 0 : 1);
}

main()
  .catch((e) => {
    console.error('ERRO', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
