// Orquestra o fluxo de "Configurar Benchmark": descoberta de concorrentes
// (competitorDiscovery.ts) -> coleta de material (referenceSync.ts, só Apify)
// -> confirmação do usuário -> análise de verdade (Gemini). O estado fica em
// `BrandConfig.benchmarkSession` (mesmo padrão de blob JSON solto já usado
// por `presentationConfig`) porque é transiente e evolui rápido — não vale a
// pena um model Prisma novo pra isso.
//
// Rotas e o cron (`queue.ts`) chamam só as funções deste módulo — nunca leem
// ou escrevem o JSON diretamente, pra manter as transições de estado num
// lugar só.

import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import prisma from './prisma.js';
import { config as appConfig } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import { logger } from './logger.js';
import { discoverCompetitors, type CompetitorCandidate } from './competitorDiscovery.js';
import { analyzeReferenceFromCollectedMaterial, type CollectedMaterial } from './referenceSync.js';
import { fetchInstagramProfileReviews } from './apifyInstagram.js';
import { fetchWebsiteReview } from './apifyWebsiteCrawler.js';

const MAX_TOTAL = 5;
const MAX_ROUNDS = 2;

export interface BenchmarkCandidate {
  id: string;
  name: string;
  websiteUrl?: string;
  instagramUrl?: string;
  reason?: string;
  confirmed: boolean;
  collected?: CollectedMaterial;
  createdReferenceIds?: string[];
}

export type BenchmarkSessionStatus =
  | 'DISCOVERING'
  | 'AWAITING_QUESTION'
  | 'AWAITING_CONFIRMATION'
  | 'ANALYZING'
  | 'DONE'
  | 'FAILED';

export interface BenchmarkSession {
  status: BenchmarkSessionStatus;
  recommended: string[];
  candidates: BenchmarkCandidate[];
  pendingQuestion?: { text: string; options?: string[]; askedAt: string };
  round: number;
  error?: string;
  updatedAt: string;
}

function toCandidate(c: CompetitorCandidate): BenchmarkCandidate {
  return {
    id: crypto.randomUUID(),
    name: c.name,
    websiteUrl: c.websiteUrl,
    instagramUrl: c.instagramUrl,
    reason: c.reason,
    confirmed: true,
  };
}

async function getBrandContext(brandId: string): Promise<{ name: string; guidelines: string }> {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, include: { config: true } });
  return { name: brand?.name ?? '', guidelines: brand?.config?.guidelines ?? '' };
}

async function saveSession(brandId: string, session: BenchmarkSession): Promise<void> {
  const toSave: BenchmarkSession = { ...session, updatedAt: new Date().toISOString() };
  await prisma.brandConfig.upsert({
    where: { brandId },
    update: { benchmarkSession: toSave as unknown as Prisma.InputJsonValue },
    create: {
      brandId,
      agentPrompt: '',
      primaryFonts: [],
      colors: [],
      guidelines: '',
      benchmarkSession: toSave as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function getBenchmarkSession(brandId: string): Promise<BenchmarkSession | null> {
  const cfg = await prisma.brandConfig.findUnique({ where: { brandId } });
  return (cfg?.benchmarkSession as unknown as BenchmarkSession | null) ?? null;
}

/** O Gemini às vezes "chuta" um handle de Instagram plausível pelo nome da
 *  empresa em vez de confirmar via busca real — a URL existe, mas o perfil
 *  não. Decidir a fonte principal pela URL presente (em vez de pelo que
 *  REALMENTE foi coletado) fazia essas referências caírem no fallback de
 *  texto mesmo quando o site tinha screenshot de verdade disponível. */
function hasRealInstagramContent(collected?: CollectedMaterial): boolean {
  const ig = collected?.instagram;
  return !!(ig && (ig.posts.length > 0 || ig.biography));
}

function pickPrimarySource(candidate: BenchmarkCandidate): { sourceType: 'WEBSITE' | 'INSTAGRAM'; analysisUrl: string } | null {
  if (hasRealInstagramContent(candidate.collected) && candidate.instagramUrl) {
    return { sourceType: 'INSTAGRAM', analysisUrl: candidate.instagramUrl };
  }
  if (candidate.websiteUrl) {
    return { sourceType: 'WEBSITE', analysisUrl: candidate.websiteUrl };
  }
  if (candidate.instagramUrl) {
    return { sourceType: 'INSTAGRAM', analysisUrl: candidate.instagramUrl };
  }
  return null;
}

/**
 * Coleta o material de VÁRIOS candidatos de uma vez — o Instagram vai tudo
 * num LOTE só (2 execuções do ator no total, não 2 por candidato: confirmado
 * testando direto na API que `directUrls` aceita várias URLs no mesmo call).
 * O site não dá pra agrupar (o teto `maxCrawlPages` do crawler é GLOBAL do
 * run, não por domínio — juntar vários sites no mesmo run daria menos
 * páginas pra cada um, não mais barato), então roda 1 crawl por site, em
 * paralelo. Se tiver site E Instagram, coleta os dois (o site vira contexto
 * extra na mesma análise, ver referenceSync.ts).
 */
async function collectAllCandidates(candidates: BenchmarkCandidate[]): Promise<BenchmarkCandidate[]> {
  const instagramUrls = candidates.map((c) => c.instagramUrl).filter((u): u is string => !!u);

  const [instagramByUrl, ...websiteResults] = await Promise.all([
    fetchInstagramProfileReviews(instagramUrls, 12),
    ...candidates.map((c) => (c.websiteUrl ? fetchWebsiteReview(c.websiteUrl, 5) : Promise.resolve(null))),
  ]);

  return candidates.map((c, i) => {
    const collected: CollectedMaterial = {};
    if (c.instagramUrl) collected.instagram = instagramByUrl.get(c.instagramUrl) ?? null;
    if (c.websiteUrl) collected.website = websiteResults[i];
    return { ...c, collected };
  });
}

/** Uma rodada de descoberta — pode terminar em pergunta pendente (se ambíguo
 *  e ainda dentro do teto de rodadas) ou seguir direto pra coleta+confirmação. */
async function runDiscoveryRound(
  brandId: string,
  recommended: string[],
  round: number,
  extraContext?: string,
): Promise<void> {
  const { name, guidelines } = await getBrandContext(brandId);
  const { competitors, question } = await discoverCompetitors(name, guidelines, {
    recommendedNames: recommended,
    maxTotal: MAX_TOTAL,
    extraContext,
    allowQuestion: true,
  });

  if (question && round < MAX_ROUNDS) {
    await saveSession(brandId, {
      status: 'AWAITING_QUESTION',
      recommended,
      candidates: competitors.map(toCandidate),
      pendingQuestion: { text: question.text, options: question.options, askedAt: new Date().toISOString() },
      round,
      updatedAt: '',
    });
    return;
  }

  const candidates = competitors.map(toCandidate);
  await saveSession(brandId, { status: 'DISCOVERING', recommended, candidates, round, updatedAt: '' });

  const withCollected = await collectAllCandidates(candidates);

  await saveSession(brandId, { status: 'AWAITING_CONFIRMATION', recommended, candidates: withCollected, round, updatedAt: '' });
}

/** Inicia o fluxo — 0 a 5 nomes recomendados, o bot preenche o resto sozinho. */
export async function startBenchmarkDiscovery(
  brandId: string,
  _slug: string,
  recommendedNames: string[],
): Promise<void> {
  try {
    await runDiscoveryRound(brandId, recommendedNames, 0);
  } catch (err) {
    logger.error('Falha ao iniciar descoberta de benchmark', { brandId, error: (err as Error).message });
    await saveSession(brandId, {
      status: 'FAILED', recommended: recommendedNames, candidates: [], round: 0,
      error: (err as Error).message, updatedAt: '',
    }).catch(() => {});
  }
}

/** Resposta do usuário a uma pergunta de ambiguidade — re-roda a descoberta
 *  com a resposta como contexto extra, até o teto de rodadas. */
export async function answerBenchmarkQuestion(brandId: string, _slug: string, answer: string): Promise<void> {
  const session = await getBenchmarkSession(brandId);
  if (!session || session.status !== 'AWAITING_QUESTION') return;

  const extraContext = `Pergunta anterior: ${session.pendingQuestion?.text}\nResposta do usuário: ${answer}`;
  try {
    await runDiscoveryRound(brandId, session.recommended, session.round + 1, extraContext);
  } catch (err) {
    logger.error('Falha ao processar resposta do benchmark', { brandId, error: (err as Error).message });
    await saveSession(brandId, { ...session, status: 'FAILED', error: (err as Error).message }).catch(() => {});
  }
}

/**
 * Sintetiza um resumo ÚNICO de branding a partir de TODAS as referências
 * ANALYZED da marca — não a análise de 1 concorrente, mas o panorama:
 * padrões recorrentes, oportunidades de diferenciação, paleta/tom
 * recomendados. Registrado em `BrandConfig.benchmarkSummary` e consumido
 * como contexto extra pelo artista (ver `brandContext.ts`). Nunca lança —
 * falha aqui não pode derrubar o fluxo de confirmação/pesquisa automática
 * que a chama.
 */
export async function synthesizeBenchmarkSummary(brandId: string): Promise<void> {
  try {
    const refs = await prisma.reference.findMany({
      where: { brandId, status: 'ANALYZED' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    if (refs.length === 0) return;

    const brand = await prisma.brand.findUnique({ where: { id: brandId } });

    const refBlocks = refs.map((r) => [
      `### ${r.name}`,
      [r.archetype, r.toneOfVoice, r.density].filter(Boolean).join(' · '),
      r.palette.length > 0 ? `Paleta: ${r.palette.join(', ')}` : '',
      r.insightsText ? r.insightsText.slice(0, 1500) : '',
    ].filter(Boolean).join('\n')).join('\n\n');

    const prompt = `
Você é um estrategista de marca. Abaixo estão análises reais de ${refs.length} concorrente(s) de "${brand?.name ?? brandId}", coletadas via benchmark automatizado (site/Instagram de verdade, não texto genérico).

${refBlocks}

Sintetize um resumo ÚNICO e consolidado (não repita a análise de cada um separadamente) que sirva de contexto direto pra um designer de IA gerar conteúdo pra esta marca. Cubra, em Markdown, direto ao ponto, sem introdução genérica:
1. Padrões visuais e de tom que se repetem entre os concorrentes (o que já é "esperado" no nicho).
2. Oportunidades claras de diferenciação pra esta marca em relação a esse panorama.
3. Uma recomendação de paleta e tom de voz pra esta marca, justificada pelo que os concorrentes fazem (ou deixam de fazer).
`;

    const ai = new GoogleGenAI({ apiKey: appConfig.geminiApiKey });
    const result = await generateWithRetry(ai, {
      model: appConfig.models.fast,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {},
    });

    await prisma.brandConfig.upsert({
      where: { brandId },
      update: { benchmarkSummary: result.text ?? '', benchmarkSummaryUpdatedAt: new Date() },
      create: {
        brandId, agentPrompt: '', primaryFonts: [], colors: [], guidelines: '',
        benchmarkSummary: result.text ?? '', benchmarkSummaryUpdatedAt: new Date(),
      },
    });
  } catch (err) {
    logger.error('Falha ao sintetizar resumo de benchmark', { brandId, error: (err as Error).message });
  }
}

/** Usuário confirma (ou desmarca) candidatos coletados — cria 1 Reference por
 *  candidato confirmado e dispara a análise de verdade (Gemini), reusando o
 *  material JÁ coletado (nunca re-chama a Apify). */
export async function confirmBenchmarkCandidates(
  brandId: string,
  slug: string,
  selections: { id: string; confirmed: boolean }[],
): Promise<void> {
  const session = await getBenchmarkSession(brandId);
  if (!session || session.status !== 'AWAITING_CONFIRMATION') return;

  const selMap = new Map(selections.map((s) => [s.id, s.confirmed]));
  const finalCandidates = session.candidates.map((c) => ({
    ...c,
    confirmed: selMap.has(c.id) ? selMap.get(c.id)! : c.confirmed,
  }));

  await saveSession(brandId, { ...session, status: 'ANALYZING', candidates: finalCandidates });

  try {
    const analyses: Promise<void>[] = [];
    for (const candidate of finalCandidates) {
      if (!candidate.confirmed) continue;
      const primary = pickPrimarySource(candidate);
      if (!primary) continue;
      const { sourceType, analysisUrl } = primary;

      const ref = await prisma.reference.create({
        data: { name: candidate.name, analysisUrl, brandId, status: 'PENDING', insights: 0, sourceType },
      });
      candidate.createdReferenceIds = [ref.id];

      analyses.push(
        analyzeReferenceFromCollectedMaterial(
          ref.id, slug, candidate.name, analysisUrl, sourceType, candidate.collected ?? {},
        ).catch((err) => logger.error('Falha ao analisar candidato de benchmark', { refId: ref.id, error: (err as Error).message })),
      );
    }

    // Espera todas as análises (mesmo as que falharem individualmente) antes
    // de sintetizar o resumo consolidado — senão o resumo ficaria baseado só
    // nas referências mais rápidas de analisar, não no conjunto todo.
    await Promise.allSettled(analyses);
    await synthesizeBenchmarkSummary(brandId);

    await saveSession(brandId, { ...session, status: 'DONE', candidates: finalCandidates });
  } catch (err) {
    logger.error('Falha ao confirmar candidatos de benchmark', { brandId, error: (err as Error).message });
    await saveSession(brandId, { ...session, status: 'FAILED', candidates: finalCandidates, error: (err as Error).message }).catch(() => {});
  }
}

/**
 * Ciclo automático (cron, `queue.ts`) — nunca pausa pra pergunta nenhuma
 * (`allowQuestion:false`). Re-valida os concorrentes já confirmados na última
 * sessão e re-analisa os MESMOS `Reference` (nunca cria nem apaga silenciosamente
 * — se um nome recomendado não for mais encontrado, marca aquele Reference como
 * FAILED com um texto explicativo, em vez de trocar por um estranho sem revisão
 * humana nenhuma).
 */
export async function runAutoResearchCycle(brandId: string, slug: string): Promise<void> {
  try {
    const previousSession = await getBenchmarkSession(brandId);
    const previousCandidates = previousSession?.candidates.filter((c) => c.confirmed) ?? [];
    const recommendedNames = previousSession?.recommended.length
      ? previousSession.recommended
      : previousCandidates.map((c) => c.name);

    await prisma.brandConfig.update({ where: { brandId }, data: { lastAutoResearchAt: new Date() } });

    if (recommendedNames.length === 0) return; // nunca rodou "Configurar Benchmark" ainda

    const { name, guidelines } = await getBrandContext(brandId);
    const { competitors } = await discoverCompetitors(name, guidelines, {
      recommendedNames, maxTotal: MAX_TOTAL, allowQuestion: false,
    });

    // Coleta o lote inteiro de uma vez (mesmo motivo do fluxo interativo: o
    // Instagram de todo mundo sai em 2 execuções do ator, não 2×N).
    const collectedCandidates = await collectAllCandidates(competitors.map(toCandidate));

    for (const candidate of collectedCandidates) {
      const prevCandidate = previousCandidates.find((c) => c.name.toLowerCase() === candidate.name.toLowerCase());
      if (!prevCandidate?.createdReferenceIds?.length) continue; // descoberta nova: v1 não auto-cria, ver plano

      for (const refId of prevCandidate.createdReferenceIds) {
        const ref = await prisma.reference.findUnique({ where: { id: refId } });
        if (!ref?.analysisUrl) continue;
        await analyzeReferenceFromCollectedMaterial(refId, slug, ref.name, ref.analysisUrl, ref.sourceType, candidate.collected ?? {})
          .catch((err) => logger.error('Falha ao re-analisar referência (pesquisa automática)', { refId, error: (err as Error).message }));
      }
    }

    for (const prevCandidate of previousCandidates) {
      const stillFound = competitors.some((f) => f.name.toLowerCase() === prevCandidate.name.toLowerCase());
      if (stillFound || !prevCandidate.createdReferenceIds?.length) continue;
      for (const refId of prevCandidate.createdReferenceIds) {
        await prisma.reference.update({
          where: { id: refId },
          data: { status: 'FAILED', insightsText: 'Não foi possível re-confirmar este concorrente na última pesquisa automática.' },
        }).catch(() => {});
      }
    }

    await synthesizeBenchmarkSummary(brandId);
  } catch (err) {
    logger.error('Falha no ciclo de pesquisa automática do benchmark', { brandId, error: (err as Error).message });
  }
}
