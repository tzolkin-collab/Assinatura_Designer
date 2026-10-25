import { z } from 'zod';
import { PREVIEW_SCOPE } from '../config.js';
import { consumeRateLimit } from '../../middleware/rateLimit.js';
import { PREVIEW_CODE_TTL_SEC, PREVIEW_SESSION_TTL_SEC, PREVIEW_START_RATE_LIMIT } from '../preview.js';
import { ToolUserError, type McpToolDefinition } from './types.js';

/**
 * start_frontend_session / end_frontend_session — abrir o Designer num navegador, SÓ PARA VER.
 *
 * O agente não digita senha. Esta ferramenta devolve uma URL com um código de uso único (60 s) que a página
 * `/mcp/entrar` do frontend troca por uma sessão de leitura de 2 h, restrita às marcas desta conexão. O código vai no
 * FRAGMENTO da URL (`#code=`): fragmento não é enviado ao servidor nem ao `Referer`, então não cai em log de acesso.
 * Toda a segurança (escopo, marcas, rastro, "uma sessão por conexão") está no `PreviewService` e no `requireAuth`.
 */

const startInput = {};
const startOutput = {
  url: z.string(),
  expiresAt: z.string(),
  expiresInSeconds: z.number(),
  codeValidForSeconds: z.number(),
  readOnly: z.literal(true),
  brands: z.array(z.object({ slug: z.string(), name: z.string() })),
};

export const startFrontendSessionTool: McpToolDefinition<typeof startInput, typeof startOutput> = {
  name: 'start_frontend_session',
  title: 'Abrir o Designer no navegador (só leitura)',
  description:
    'Gera um link para VOCÊ abrir o editor e a galeria do Designer num navegador e ver a peça renderizada, sem senha. ' +
    'O acesso é SOMENTE LEITURA (não edita, não exporta, não apaga), só das marcas liberadas nesta conexão, e acaba sozinho em 2 horas. ' +
    'O link carrega um código de uso único que vale ~60 segundos: abra-o logo; se expirar, chame esta ferramenta de novo. ' +
    'Cada chamada ENCERRA a sessão anterior desta conexão (só existe uma por vez). Quando terminar, chame end_frontend_session. ' +
    'Não recebe parâmetros. Exige o escopo designer.preview, que o usuário precisa ter liberado ao conectar.',
  scope: PREVIEW_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: startInput,
  outputSchema: startOutput,

  async handler(ctx) {
    if (!ctx.preview || !ctx.frontendOrigin) {
      throw new ToolUserError('A sessão de navegador não está disponível neste servidor.', 'preview_unavailable');
    }
    if (ctx.grants.length === 0) {
      throw new ToolUserError('Nenhuma marca disponível para esta conexão. Não há o que abrir.', 'no_brand');
    }
    const limit = await consumeRateLimit(PREVIEW_START_RATE_LIMIT, ctx.familyId);
    if (!limit.allowed) {
      throw new ToolUserError(`Muitos pedidos de sessão seguidos. Tente de novo em ${limit.retryAfterSec} s.`, 'rate_limited');
    }

    const started = await ctx.preview.start({ userId: ctx.userId, familyId: ctx.familyId, clientId: ctx.clientId });
    const url = new URL('/mcp/entrar', ctx.frontendOrigin);
    url.hash = `code=${started.code}`;

    const brands = ctx.grants.map((g) => ({ slug: g.slug, name: g.name }));
    const expiresAt = new Date(started.expiresAt).toISOString();
    return {
      text: [
        `Abra este link agora no navegador (vale ~${PREVIEW_CODE_TTL_SEC} s e só funciona uma vez): ${url.href}`,
        `Modo somente leitura. A sessão termina em ${expiresAt} (2 h) ou quando você chamar end_frontend_session.`,
        `Marcas visíveis: ${brands.map((b) => b.name).join(', ')}.`,
      ].join('\n'),
      structured: {
        url: url.href,
        expiresAt,
        expiresInSeconds: PREVIEW_SESSION_TTL_SEC,
        codeValidForSeconds: PREVIEW_CODE_TTL_SEC,
        readOnly: true,
        brands,
      },
    };
  },
};

const endInput = {};
const endOutput = { ended: z.boolean() };

export const endFrontendSessionTool: McpToolDefinition<typeof endInput, typeof endOutput> = {
  name: 'end_frontend_session',
  title: 'Encerrar a sessão do navegador',
  description:
    'Encerra agora a sessão de navegador (somente leitura) aberta por start_frontend_session nesta conexão: o link e o cookie deixam de valer. ' +
    'Pode ser chamada sem sessão aberta (devolve ended=false). Não recebe parâmetros. Exige o escopo designer.preview.',
  scope: PREVIEW_SCOPE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: endInput,
  outputSchema: endOutput,

  async handler(ctx) {
    if (!ctx.preview) throw new ToolUserError('A sessão de navegador não está disponível neste servidor.', 'preview_unavailable');
    const ended = await ctx.preview.endForFamily(ctx.familyId, { userId: ctx.userId, clientId: ctx.clientId }, 'ended_by_agent');
    return {
      text: ended ? 'Sessão encerrada. O link e o cookie não valem mais.' : 'Não havia sessão aberta nesta conexão.',
      structured: { ended },
    };
  },
};
