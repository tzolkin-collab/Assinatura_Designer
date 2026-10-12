// TEMPORÁRIO — refaz o exemplo "Amanda Coelho" com as correções da Fase 1. Não commitar.
import 'dotenv/config';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { createSession, getSession } from '../src/lib/redis.js';
import { runPipeline } from '../src/agents/pipeline.js';
import { buildSlideDocument } from '../src/lib/htmlDesign.js';
import { renderHtmlToBase64 } from '../src/lib/htmlRaster.js';

const SLUG = 'amanda-coelho';
const OUT = process.env.OUT_DIR!;

// Mesmo texto do exemplo anterior (sem nenhum fato sobre a Amanda). Um bloco por slide, na ordem.
const COPY = `Estratégia para uma vida mais extraordinária
Uma forma de pensar negócios, carreira e escolhas com clareza, repertório e coragem.

Todo resultado começa em uma decisão
Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir? Quando a resposta é clara, o caminho deixa de ser ruído e passa a ser direção. Estratégia não é complicar; é escolher com consciência o que fica e o que sai.

Crescer sem direção cansa
Muita energia vai para tarefas que parecem urgentes e não levam a lugar nenhum. Sem um critério claro, cada oportunidade parece igual, e a agenda se enche de compromissos que não conversam com o futuro que se quer viver.

Três movimentos para ganhar clareza
Primeiro, enxergar o cenário como ele é, sem filtros. Depois, decidir com critério, assumindo o que se escolhe e o que se abandona. Por fim, executar com consistência, ajustando o rumo sem perder a essência.

Negócios sólidos nascem de decisões conscientes
Empresas duradouras não dependem de sorte nem de pressa. Elas se apoiam em posicionamento claro, em pessoas bem escolhidas e em hábitos de gestão que se repetem mesmo quando ninguém está olhando.

Uma vida extraordinária também é planejada
O que se constrói no trabalho precisa caber na vida que se deseja. Tempo, energia e propósito entram na mesma conta: não há estratégia boa que exija abrir mão de tudo o que importa.

O próximo passo é uma boa conversa
Se faz sentido pensar o seu momento com mais método e mais coragem, o primeiro movimento é simples: sentar, olhar o cenário e decidir juntos por onde começar.`;

const BRIEF = 'Apresentação de 7 slides com o texto aprovado fornecido, na ordem, um bloco por slide. Nenhuma foto foi fornecida ainda: reserve a área da foto onde fizer sentido.';

const [cmd, arg] = process.argv.slice(2);

async function run() {
  delete process.env.DESIGNER_BRAIN_BRANDS; // sem a flag: o cérebro tem de ligar sozinho pela ficha salva
  console.log('DESIGNER_BRAIN_BRANDS definida?', process.env.DESIGNER_BRAIN_BRANDS !== undefined);
  const sessionId = randomUUID(), postId = randomUUID();
  await createSession(sessionId, SLUG, undefined, 'auto');
  const t0 = Date.now();
  await runPipeline({ sessionId, postId, brief: BRIEF, format: 'presentation', sourceCopy: COPY });
  const s: any = await getSession(sessionId);
  console.log(`POSTID=${postId} duração=${Math.round((Date.now() - t0) / 1000)}s fase=${s?.phase}`);
  console.log('REVIEW=' + JSON.stringify(s?.pendingReview ?? null));
}

async function analyze(postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  const c: any = post?.content;
  const rows = await prisma.slide.findMany({ where: { postId }, orderBy: { position: 'asc' } });
  console.log(`post nome=${JSON.stringify(post?.name)} status=${post?.status} slides=${rows.length} fontes=${JSON.stringify(c?.fonts)} ${c?.width}x${c?.height}`);
  for (const r of rows) {
    const cj: any = r.contentJson, meta: any = r.metadata;
    const html: string = cj.html ?? '';
    const texto = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`\n[${r.position + 1}] layout=${meta?.layout_type} título="${meta?.title}"`);
    console.log('  texto visível:', texto.slice(0, 500));
    console.log('  imgs:', (html.match(/<img/g) ?? []).length, ' espaços de foto:', (html.match(/data-photo-slot=/g) ?? []).length, ' molduras padrão:', (html.match(/data-photo-empty/g) ?? []).length);
    const doc = buildSlideDocument({ html: cj.html, css: cj.css }, c.fonts ?? ['Inter'], c.width, c.height);
    fs.writeFileSync(`${OUT}/amanda2-s${r.position + 1}.png`, Buffer.from(await renderHtmlToBase64(doc, { width: c.width, height: c.height, maxDim: 1280 }), 'base64'));
  }
}

(async () => {
  if (cmd === 'run') await run();
  else if (cmd === 'analyze') await analyze(arg!);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
