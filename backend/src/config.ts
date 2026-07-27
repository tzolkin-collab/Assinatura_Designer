import dotenv from 'dotenv';
dotenv.config();

/**
 * Preço por modelo, em USD por 1M de tokens, com input e output SEPARADOS — no Gemini
 * o output custa ~5-8x o input, então um preço único mentiria feio num deck (muito
 * output) contra um chat (muito input).
 *
 * Estes defaults são ESTIMATIVA e envelhecem: a fatura real é a do Google. Servem só
 * para dar ordem de grandeza na tela. Sobrescreva com AI_MODEL_PRICES (JSON) quando o
 * preço mudar — o env sempre vence o default, modelo a modelo.
 */
export type ModelPrice = { input: number; output: number };

const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-3.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
};

function parseModelPrices(raw: string | undefined): Record<string, ModelPrice> {
  const merged: Record<string, ModelPrice> = { ...DEFAULT_MODEL_PRICES };
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    for (const [model, price] of Object.entries(parsed)) {
      const input = Number(price?.input);
      const output = Number(price?.output);
      if (Number.isFinite(input) && Number.isFinite(output)) {
        merged[model] = { input, output };
      }
    }
  } catch {
    // JSON inválido no env não pode derrubar o boot: fica só com os defaults.
    console.warn('⚠️  AI_MODEL_PRICES não é um JSON válido; usando a tabela de preço padrão.');
  }
  return merged;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // ── Modelos por PAPEL ──
  // A escolha de modelo estava espalhada por ~10 arquivos como string solta:
  // trocar o modelo do planner era caçada de grep, e o do brain nem env tinha.
  // Papel → modelo, num lugar só, cada um com override por env.
  models: {
    /** A arte: geração de deck e edição de slide. Tier "artista" do geminiRetry. */
    artist: process.env.GEMINI_DESIGN_DOCUMENT_MODEL || 'gemini-3.1-pro-preview',
    /** O cérebro do chat da Fábrica (multimodal, streaming, decide DISPATCH/EDIT). */
    brain: process.env.GEMINI_BRAIN_MODEL || 'gemini-2.5-pro',
    /** Planner/roteirista, reviewer textual, pesquisa: rápido > perfeito. */
    fast: process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash',
    /** Tarefas mecânicas (classificar, extrair, sugerir): o mais barato que funciona. */
    utility: process.env.GEMINI_UTILITY_MODEL || 'gemini-2.5-flash-lite',
    /** Geração de imagem/foto (lib/imageResolver.ts). Fallback pro flash-image se o pro estourar cota. */
    image: process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview',
    imageFallback: process.env.GEMINI_IMAGE_FALLBACK_MODEL || 'gemini-2.5-flash-image',
  },
  // Teto de tokens de "thinking" na geração. O modelo pro às vezes gasta quase
  // todo o maxOutputTokens pensando e trunca o JSON (finishReason MAX_TOKENS →
  // "did not contain valid JSON"). Limitar o thinking deixa a maior parte do
  // orçamento para o output. -1 = dinâmico/ilimitado, 0 = sem thinking.
  geminiThinkingBudget: parseInt(process.env.GEMINI_THINKING_BUDGET || '12288', 10),
  // ── Teto de gasto de IA (por dia, em tokens) ──
  // Não existia teto nenhum: um deck grande dispara dezenas de chamadas simultâneas
  // ao Gemini, e um brief mal formado queimava caixa sem ninguém ver. Contamos em
  // tokens (exatos, vêm do provedor) e não em reais (tabela de preço envelhece calada).
  // 0 = sem limite.
  aiDailyTokenBudget: parseInt(process.env.AI_DAILY_TOKEN_BUDGET || '20000000', 10),
  aiBrandDailyTokenBudget: parseInt(process.env.AI_BRAND_DAILY_TOKEN_BUDGET || '5000000', 10),
  // Teto de imagens GERADAS (não reaproveitadas da biblioteca) por deck — cada uma é uma
  // chamada de modelo de imagem, mais cara e lenta que texto. 0 = nunca gera, só reaproveita.
  maxGeneratedImagesPerDeck: parseInt(process.env.MAX_GENERATED_IMAGES_PER_DECK || '6', 10),
  // Só para estimar o custo no log. 0 = não estima (default: não chutamos preço).
  // Também é o preço de reserva (input=output) para um modelo fora da tabela abaixo.
  aiUsdPerMillionTokens: parseFloat(process.env.AI_USD_PER_MILLION_TOKENS || '0'),
  // ── Billing / transparência de gasto ──
  // Preço por modelo (input/output USD/1M). Estimativa, sobrescrevível por AI_MODEL_PRICES.
  aiModelPrices: parseModelPrices(process.env.AI_MODEL_PRICES),
  // Câmbio para exibir o gasto em R$. 0 = mostra em US$ (não inventamos câmbio).
  aiUsdToBrl: parseFloat(process.env.AI_USD_TO_BRL || '0'),
  // Alíquota de imposto sobre o gasto (fração: 0.0638 = 6,38% de IOF, por ex.). É
  // mostrada SEPARADA do gasto na tela, nunca embutida no preço do modelo. 0 = sem imposto.
  aiTaxRate: parseFloat(process.env.AI_TAX_RATE || '0'),
  // ── Timeout por tentativa ──
  // Um modelo lento é pior que um modelo fora do ar: ele não dá erro, então o retry
  // e o circuit breaker nunca entram, e a chamada só… demora. Medido: o
  // gemini-3.5-flash levou 70s para responder "oi" (ele "pensa" por padrão), enquanto
  // o 2.5-flash responde o mesmo em 0,8s. Estourado o tempo, cai para o próximo modelo.
  //
  // O corte é por PESO DO MODELO, não por feature: a edição de um slide é "leve" como
  // fluxo, mas roda no pro e legitimamente passa de 25s. Modelo pro = geração pesada
  // (40-75s é normal num lote de slides); flash = chamada que deveria ser rápida.
  aiTimeoutLightMs: parseInt(process.env.AI_TIMEOUT_LIGHT_MS || '25000', 10),
  aiTimeoutHeavyMs: parseInt(process.env.AI_TIMEOUT_HEAVY_MS || '150000', 10),
  // ── Cota / rate limit ──
  // Teto de chamadas SIMULTÂNEAS por modelo. É um ponto de partida, não uma promessa:
  // o controle de congestão (lib/aiThrottle.ts) desce sozinho quando toma 429 e volta
  // a subir quando a cota respira. Deixe-o folgado — quem descobre o limite real da
  // cota é o AIMD, não este número.
  aiMaxInflightPerModel: parseInt(process.env.AI_MAX_INFLIGHT_PER_MODEL || '8', 10),
  // Quantas vezes insistir no MESMO modelo quando o erro é 429 (rate limit). Alto de
  // propósito: 429 é oscilação de cota causada pela nossa própria paralelização, e
  // desistir dele significaria terminar o deck com um modelo pior. Esperar é de graça
  // (só tempo); trocar de modelo custa a estética do deck inteiro.
  aiRateLimitRetries: parseInt(process.env.AI_RATE_LIMIT_RETRIES || '6', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  // ── Cloudflare R2 ──
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2BucketName: process.env.R2_BUCKET_NAME || '',
  r2PublicUrl: process.env.R2_PUBLIC_URL || '',
  // ── Redis ──
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  // ── Fila de geração (BullMQ) ──
  // Quantos pipelines de design rodam em paralelo por worker. Cada um usa
  // Gemini + chromium (pesado), então o default é conservador.
  pipelineConcurrency: parseInt(process.env.PIPELINE_CONCURRENCY || '2', 10),
  // Quantos LOTES de slides são gerados em paralelo DENTRO de uma apresentação.
  // O lote 1 sempre roda sozinho (ancora a direção de arte); os demais correm em
  // pool. Total de chamadas Gemini simultâneas ≈ pipelineConcurrency × este valor,
  // então cuidado com rate limit. Default conservador.
  generationConcurrency: parseInt(process.env.GENERATION_CONCURRENCY || '2', 10),
  // Se true, o próprio processo da API também processa a fila (deploy de 1
  // processo). Coloque false na API e rode `node dist/worker.js` separado para
  // escalar workers independentemente.
  runWorkerInProcess: process.env.RUN_WORKER_IN_PROCESS !== 'false',
  // Reviewer VISUAL do IR: rasteriza os slides no chromium e o modelo multimodal
  // vê a arte. É a QA mais forte, mas adiciona render + 1 chamada pro por geração.
  // Desligue (=false) para cair só no reviewer estrutural + semântico (flash).
  reviewerVisual: process.env.REVIEWER_VISUAL !== 'false',
  // Quantos slides o crítico visual vê. A amostra é ESPALHADA pelo deck (capa,
  // encerramento e o meio distribuído), não os N primeiros. Subir custa render +
  // tokens de imagem por geração.
  reviewerSampleSize: parseInt(process.env.REVIEWER_SAMPLE_SIZE || '8', 10),
  // ── Canva Connect API ──
  canvaClientId: process.env.CANVA_CLIENT_ID || '',
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET || '',
  canvaRedirectUri: process.env.CANVA_REDIRECT_URI || 'http://localhost:4000/api/canva/callback',
  canvaTokenEncryptionKey: process.env.CANVA_TOKEN_ENCRYPTION_KEY || '',
  // Scopes cadastrados no app do Canva. Apenas os explicitamente habilitados no portal.
  // design:meta:read  → listar/obter designs
  // design:content:read → exportar designs
  // design:content:write → criar designs, autofill, merge
  // asset:write → upload de assets
  // profile:read → identificar o usuário Canva
  canvaScopes: 'design:meta:read design:content:read design:content:write asset:write profile:read',
  // ── Asana API ──
  asanaClientId: process.env.ASANA_CLIENT_ID || '',
  asanaClientSecret: process.env.ASANA_CLIENT_SECRET || '',
  asanaRedirectUri: process.env.ASANA_REDIRECT_URI || 'http://localhost:4000/api/asana/callback',
  // ── Unsplash (fallback de foto real) ──
  // A geração por IA continua sendo o caminho principal; Unsplash entra só quando (a)
  // o gasto de IA da marca já está alto (ver AI_PHOTO_FALLBACK_USAGE_RATIO) ou (b) a
  // autoverificação de coerência reprova a foto gerada (ver imageResolver.ts). Sem
  // chave configurada, o fallback fica OFF (mesmo comportamento de antes: skip).
  unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || '',
  // Fração do teto diário de tokens da MARCA (0-1) a partir da qual preferimos
  // Unsplash a gerar mais uma foto por IA. 0 = nunca usa esse gatilho (só a
  // autoverificação de qualidade decide).
  aiPhotoFallbackUsageRatio: parseFloat(process.env.AI_PHOTO_FALLBACK_USAGE_RATIO || '0.8'),
  // ── Apify (benchmarking do Instagram) ──
  // Instagram bloqueia screenshot headless (Microlink etc.) — sem isto, a análise
  // de referência do Instagram nunca via a imagem de verdade, só um fallback fraco
  // de Google Search grounding. Free tier da Apify: $5/mês, sem cartão.
  apifyApiToken: process.env.APIFY_API_TOKEN || '',
} as const;

// ── Fail-fast de configuração ────────────────────────────────────────────────
// Em produção, segredos ausentes ou o JWT_SECRET de fallback são falha de
// segurança (qualquer um forjaria tokens). Recusamos subir o servidor em vez de
// rodar inseguro. Em dev, apenas avisamos para não atrapalhar o fluxo local.
const INSECURE_JWT_FALLBACK = 'fallback-dev-secret';

export function validateConfig(): void {
  const problems: string[] = [];

  if (!config.jwtSecret || config.jwtSecret === INSECURE_JWT_FALLBACK) {
    problems.push('JWT_SECRET ausente ou usando o fallback inseguro de desenvolvimento');
  }
  if (!config.databaseUrl) {
    problems.push('DATABASE_URL ausente');
  }
  if (!config.geminiApiKey) {
    problems.push('GEMINI_API_KEY ausente (nenhuma geração de design funcionará)');
  }
  if (!config.canvaClientId || !config.canvaClientSecret) {
    problems.push('CANVA_CLIENT_ID e/ou CANVA_CLIENT_SECRET ausentes (integração com Canva não funcionará)');
  }

  if (problems.length === 0) return;

  const header = 'Configuração inválida:';
  const list = problems.map((p) => `  - ${p}`).join('\n');

  if (config.nodeEnv === 'production') {
    // Fail-fast: aborta o boot em produção.
    throw new Error(`${header}\n${list}\n\nDefina as variáveis de ambiente obrigatórias antes de iniciar em produção.`);
  }

  console.warn(`\n⚠️  ${header}\n${list}\n   (permitido em desenvolvimento; obrigatório em produção)\n`);
}
