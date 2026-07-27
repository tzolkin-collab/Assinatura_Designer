// Descobre concorrentes de verdade pra uma marca, sem o usuário precisar
// digitar nome+URL de cada um manualmente. Usa o Gemini com Google Search
// grounding (o mesmo mecanismo já usado no fallback de Instagram em
// referenceSync.ts) pra pesquisar a internet de verdade, entender o nicho da
// marca a partir das diretrizes cadastradas, e decidir sozinho quantos
// concorrentes fazem sentido comparar (no máximo 5, nunca mais).
//
// Também resolve as URLs de nomes que o próprio usuário já recomendou
// (`recommendedNames`) — o mesmo call de pesquisa cobre "descobrir do zero" e
// "resolver o que o usuário já indicou", já que ambos precisam da mesma busca
// real na internet.

import { GoogleGenAI } from '@google/genai';
import { config as appConfig } from '../config.js';
import { generateWithRetry } from './geminiRetry.js';
import { extractJsonObject } from './jsonHelper.js';
import { logger } from './logger.js';

export interface CompetitorCandidate {
  name: string;
  websiteUrl?: string;
  instagramUrl?: string;
  reason?: string;
}

export interface DiscoverCompetitorsOptions {
  /** Nomes que o usuário já recomendou (0 a 5) — o modelo resolve a URL de
   *  cada um antes de procurar concorrentes novos pros slots restantes. */
  recommendedNames?: string[];
  /** Teto TOTAL de concorrentes (recomendados + descobertos). Default 5. */
  maxTotal?: number;
  /** Contexto extra de uma rodada anterior (ex: resposta a uma pergunta de
   *  ambiguidade) — prependado ao prompt quando presente. */
  extraContext?: string;
  /** Se o modelo pode pausar com uma pergunta de ambiguidade/baixa confiança
   *  em vez de responder direto. Default true; o ciclo automático (cron) deve
   *  passar `false` pra nunca pausar sem ninguém olhando. */
  allowQuestion?: boolean;
}

export interface DiscoverCompetitorsResult {
  competitors: CompetitorCandidate[];
  /** Presente só quando o modelo genuinamente não tem confiança suficiente
   *  (nome ambíguo, nicho pouco claro) — nunca como enrolação. */
  question?: { text: string; options?: string[] };
}

/**
 * Pesquisa a internet e devolve os concorrentes encontrados (+ uma pergunta,
 * se o modelo precisar de mais contexto). Nunca lança — em caso de falha
 * (Gemini indisponível, resposta sem JSON válido), devolve `{competitors:[]}`,
 * deixando o chamador decidir como avisar o usuário.
 */
export async function discoverCompetitors(
  brandName: string,
  guidelines: string,
  options: DiscoverCompetitorsOptions = {},
): Promise<DiscoverCompetitorsResult> {
  const { recommendedNames = [], maxTotal = 5, extraContext, allowQuestion = true } = options;
  const remainingSlots = Math.max(0, maxTotal - recommendedNames.length);

  try {
    const ai = new GoogleGenAI({ apiKey: appConfig.geminiApiKey });

    const prompt = `
Você é um analista de mercado. Pesquise na internet e identifique concorrentes DIRETOS reais da marca abaixo — nunca invente marcas que você não confirmou existirem.

${extraContext ? `Contexto adicional de uma rodada anterior:\n${extraContext}\n` : ''}
Marca: ${brandName}
Diretrizes/Nicho cadastrado: ${guidelines?.trim() || '(sem diretrizes cadastradas — infira o nicho a partir do nome da marca e do que encontrar na pesquisa)'}

Teto TOTAL de concorrentes: no máximo ${maxTotal}, nunca mais que isso.
${recommendedNames.length > 0
  ? `O usuário já recomendou estes nomes (resolva o site oficial e o Instagram oficial de CADA UM primeiro — eles contam como slots já ocupados, não descarte nenhum): ${recommendedNames.join(', ')}.\nDepois de resolver os recomendados, procure até ${remainingSlots} concorrente(s) NOVO(S) reais pra preencher o restante dos ${maxTotal} slots (decida você mesmo se faz sentido preencher todos ou só alguns).`
  : `Decida você mesmo quantos concorrentes fazem sentido analisar (até o teto de ${maxTotal} — nem de menos pra perder o panorama, nem de mais pra diluir o foco).`}

Para cada concorrente (recomendado ou descoberto), retorne:
- name: nome da marca
- websiteUrl: URL do site oficial, se encontrar
- instagramUrl: URL do perfil oficial do Instagram, SÓ se você tiver encontrado evidência real dele na pesquisa (um resultado de busca, um link citado em outra página, etc.) — NUNCA adivinhe um handle plausível a partir do nome da empresa (ex: "empresax" -&gt; "@empresax_oficial"). Um handle inventado que não existe é pior que deixar o campo vazio: se não encontrar evidência real, omita "instagramUrl" e deixe a análise se apoiar só no site.
- reason: 1 frase curta do porquê esse concorrente é relevante pra comparar
${allowQuestion ? `
Se e SÓ SE você genuinamente não conseguir resolver um nome recomendado (ambíguo — várias empresas com esse nome — ou nicho pouco claro pra descobrir concorrentes de verdade), inclua um campo irmão "question" com uma pergunta curta pro usuário (e opcionalmente "options" com alternativas). NÃO use isso como enrolação — só em ambiguidade real.` : ''}

Retorne SOMENTE um JSON puro, sem markdown, sem texto antes ou depois, exatamente neste formato:
{ "competitors": [ { "name": "...", "websiteUrl": "...", "instagramUrl": "...", "reason": "..." } ]${allowQuestion ? ', "question": { "text": "...", "options": ["...", "..."] }' : ''} }
`;

    // Tools (Google Search) e responseSchema/responseMimeType são MUTUAMENTE
    // EXCLUSIVOS na API do Gemini (400 se combinados) — mesma lição de
    // referenceSync.ts. Aqui SEMPRE usamos tools (é o ponto inteiro: pesquisa
    // real), então nunca passamos responseSchema junto.
    const result = await generateWithRetry(ai, {
      model: appConfig.models.fast,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: { tools: [{ googleSearch: {} }] },
    });

    const parsed = extractJsonObject(result.text ?? '{}') as {
      competitors?: CompetitorCandidate[];
      question?: { text?: string; options?: string[] };
    };
    const competitors = (Array.isArray(parsed.competitors) ? parsed.competitors : [])
      .filter((c) => c && typeof c.name === 'string' && c.name.trim() && (c.websiteUrl || c.instagramUrl))
      .slice(0, maxTotal);

    const question = allowQuestion && parsed.question?.text
      ? { text: parsed.question.text, options: parsed.question.options }
      : undefined;

    return { competitors, question };
  } catch (err) {
    logger.warn('Falha ao descobrir concorrentes', { brandName, error: (err as Error).message });
    return { competitors: [] };
  }
}
