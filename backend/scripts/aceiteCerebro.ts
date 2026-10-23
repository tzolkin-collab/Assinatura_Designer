// Testes de aceite do cerebro (checklist da Gabriela, secao 10) direto no pipeline, sem chat nem fila.
// Uso: pnpm exec tsx scripts/aceiteCerebro.ts <t1|t3|t4|t4b|t6|gpt1> [sem-cerebro]. Grava um deck de verdade na marca do cenario
// (banco e Gemini reais; ~US$ 0,40 por execucao). Apague o deck depois.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../src/lib/prisma.js';
import { createSession, getSession } from '../src/lib/redis.js';
import { runPipeline } from '../src/agents/pipeline.js';

const AMANDA_COLORS = ['#410c1c', '#8e242e', '#d8e9f3', '#fcf9eb'];
const AMANDA_FONTS = ['playfair', 'manrope', 'queens', 'aeonik'];

const BASE = `Estratégia para uma vida mais extraordinária
Uma forma de pensar negócios, carreira e escolhas com clareza, repertório e coragem.

Todo resultado começa em uma decisão
Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir?

Crescer sem direção cansa
Muita energia vai para tarefas que parecem urgentes e não levam a lugar nenhum.

O próximo passo é uma boa conversa
Sentar, olhar o cenário e decidir juntos por onde começar.`;

const FALA = 'Gravar este trecho falando devagar e olhando para a câmera, com sorriso discreto XPTOFALA.';
const CONTEXTO = 'Cliente pediu tom institucional para a diretoria XPTOCONTEXTO.';

const SCENARIOS: Record<string, { slug: string; brief: string; copy: string }> = {
  t1: { slug: 'amanda-coelho', copy: BASE, brief: 'Apresentação de 4 slides com o texto aprovado, na ordem, um bloco por slide. Nenhuma foto foi fornecida: reserve a área da foto onde fizer sentido.' },
  t3: {
    slug: 'amanda-coelho',
    copy: `[APROVADO]\n${BASE}\n\n[FALA]\n${FALA}\n\n[CONTEXTO]\n${CONTEXTO}`,
    brief: 'Apresentação de 4 slides com o texto aprovado, na ordem. Sem fotos.',
  },
  t4: {
    slug: 'amanda-coelho',
    copy: BASE + '\n\n' + BASE.replace(/\n\n/g, '\n\nContinuação: ') + '\n\nMais um bloco longo para estourar a quantidade fechada: ' + 'texto '.repeat(120),
    brief: 'Apresentação de exatamente 3 slides. Use todo o texto fornecido.',
  },
  t4b: {
    slug: 'amanda-coelho',
    brief: 'Apresentação de exatamente 3 slides. Use todo o texto fornecido, sem cortar nada.',
    copy: `Todo resultado começa em uma decisão
Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir? Quando a resposta é clara, o caminho deixa de ser ruído e passa a ser direção. Estratégia não é complicar; é escolher com consciência o que fica e o que sai, e assumir o custo de cada escolha.

Crescer sem direção cansa
Muita energia vai para tarefas que parecem urgentes e não levam a lugar nenhum. Sem um critério claro, cada oportunidade parece igual, e a agenda se enche de compromissos que não conversam com o futuro que se quer viver. O cansaço não vem do trabalho, vem da falta de rumo.

Três movimentos para ganhar clareza
Primeiro, enxergar o cenário como ele é, sem filtros. Depois, decidir com critério, assumindo o que se escolhe e o que se abandona. Por fim, executar com consistência, ajustando o rumo sem perder a essência.

Negócios sólidos nascem de decisões conscientes
Empresas duradouras não dependem de sorte nem de pressa. Elas se apoiam em posicionamento claro, em pessoas bem escolhidas e em hábitos de gestão que se repetem mesmo quando ninguém está olhando.

Uma vida extraordinária também é planejada
O que se constrói no trabalho precisa caber na vida que se deseja. Tempo, energia e propósito entram na mesma conta: não há estratégia boa que exija abrir mão de tudo o que importa.

O próximo passo é uma boa conversa
Se faz sentido pensar o seu momento com mais método e mais coragem, o primeiro movimento é simples: sentar, olhar o cenário e decidir juntos por onde começar.`,
  },
  gpt1: {
    slug: 'amanda-coelho',
    brief: fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'benchmark', 'lote1-gabriela', 'brief.txt'), 'utf8'),
    copy: fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'benchmark', 'lote1-gabriela', 'copy.txt'), 'utf8'),
  },
  t6: { slug: 'assinatura', copy: BASE, brief: 'Apresentação de 4 slides com o texto fornecido, na ordem. Sem fotos.' },
};

const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const id = process.argv[2]!;
  const sc = SCENARIOS[id];
  if (!sc) throw new Error('cenário inválido');
  // O cérebro é global (padrão): apagar DESIGNER_BRAIN_BRANDS NÃO o desliga mais; ele liga em toda marca, com ou
  // sem ficha. Para o cenário "sem cérebro" passe `sem-cerebro` como 2o argumento: define DESIGNER_BRAIN_GLOBAL=off
  // (a saída de emergência; nela uma marca COM ficha ainda liga o cérebro, e sem ficha volta ao caminho antigo).
  // Só esse cenário define DESIGNER_BRAIN_GLOBAL: nos demais, o valor que o desenvolvedor já pôs no ambiente é
  // respeitado, e quando ela não existe vale o padrão (cérebro global ligado), sem precisar definir nada.
  delete process.env.DESIGNER_BRAIN_BRANDS;
  if (process.argv[3] === 'sem-cerebro') process.env.DESIGNER_BRAIN_GLOBAL = 'off';
  const sessionId = randomUUID(), postId = randomUUID();
  await createSession(sessionId, sc.slug, undefined, 'auto');
  const t0 = Date.now();
  await runPipeline({ sessionId, postId, brief: sc.brief, format: 'presentation', sourceCopy: sc.copy });
  const s: any = await getSession(sessionId);
  const post = await prisma.post.findUnique({ where: { id: postId } });
  const slides = await prisma.slide.findMany({ where: { postId }, orderBy: { position: 'asc' } });
  const c: any = post?.content;
  const all = slides.map((r) => `${(r.contentJson as any)?.html ?? ''}\n${(r.contentJson as any)?.css ?? ''}`).join('\n').toLowerCase();
  const visible = slides.map((r) => strip((r.contentJson as any)?.html ?? '')).join(' | ');
  const out: any = {
    test: id, postId, brand: sc.slug, seconds: Math.round((Date.now() - t0) / 1000), phase: s?.phase,
    slides: slides.length, fonts: c?.fonts, review: s?.pendingReview ?? null,
    imgs: slides.reduce((n, r) => n + (((r.contentJson as any)?.html ?? '').match(/<img/g) ?? []).length, 0),
    photoSlots: (all.match(/data-photo-slot=/g) ?? []).length,
    emptyFrames: (all.match(/data-photo-empty/g) ?? []).length,
    amandaColorsFound: AMANDA_COLORS.filter((x) => all.includes(x)),
    amandaFontsFound: AMANDA_FONTS.filter((x) => all.includes(x) || JSON.stringify(c?.fonts ?? '').toLowerCase().includes(x)),
    leakedFala: visible.includes('XPTOFALA') || /olhando para a c[aâ]mera/i.test(visible),
    leakedContexto: visible.includes('XPTOCONTEXTO') || /diretoria/i.test(visible),
    visibleText: visible.slice(0, 1500),
  };
  console.log('RESULT ' + JSON.stringify(out, null, 2));
}

main().then(() => prisma.$disconnect()).then(() => process.exit(0)).catch((e) => { console.error('ERRO', e?.message ?? e); process.exit(1); });
