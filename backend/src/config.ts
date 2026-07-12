import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // Cérebro de design padrão: Gemini 3.1 Pro (multimodal). Override via env.
  // (gemini-3-pro-preview foi descontinuado no endpoint de geração; 3.1 é o pro atual.)
  geminiDesignDocumentModel: process.env.GEMINI_DESIGN_DOCUMENT_MODEL || 'gemini-3.1-pro-preview',
  // Teto de tokens de "thinking" na geração. O modelo pro às vezes gasta quase
  // todo o maxOutputTokens pensando e trunca o JSON (finishReason MAX_TOKENS →
  // "did not contain valid JSON"). Limitar o thinking deixa a maior parte do
  // orçamento para o output. -1 = dinâmico/ilimitado, 0 = sem thinking.
  geminiThinkingBudget: parseInt(process.env.GEMINI_THINKING_BUDGET || '12288', 10),
  nanoBananaApiKey: process.env.NANO_BANANA_API_KEY || '',
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
  generationConcurrency: parseInt(process.env.GENERATION_CONCURRENCY || '4', 10),
  // Se true, o próprio processo da API também processa a fila (deploy de 1
  // processo). Coloque false na API e rode `node dist/worker.js` separado para
  // escalar workers independentemente.
  runWorkerInProcess: process.env.RUN_WORKER_IN_PROCESS !== 'false',
  // Reviewer VISUAL do IR: rasteriza os slides no chromium e o modelo multimodal
  // vê a arte. É a QA mais forte, mas adiciona render + 1 chamada pro por geração.
  // Desligue (=false) para cair só no reviewer estrutural + semântico (flash).
  reviewerVisual: process.env.REVIEWER_VISUAL !== 'false',
  // ── Canva Connect API ──
  canvaClientId: process.env.CANVA_CLIENT_ID || '',
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET || '',
  canvaRedirectUri: process.env.CANVA_REDIRECT_URI || 'http://localhost:4000/api/canva/callback',
  canvaScopes: 'design:content:read design:content:write design:meta:read asset:read asset:write folder:read folder:write profile:read',
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

  if (problems.length === 0) return;

  const header = 'Configuração inválida:';
  const list = problems.map((p) => `  - ${p}`).join('\n');

  if (config.nodeEnv === 'production') {
    // Fail-fast: aborta o boot em produção.
    throw new Error(`${header}\n${list}\n\nDefina as variáveis de ambiente obrigatórias antes de iniciar em produção.`);
  }

  console.warn(`\n⚠️  ${header}\n${list}\n   (permitido em desenvolvimento; obrigatório em produção)\n`);
}
