import { logger } from '../lib/logger.js';
import { randomSecret, sha256Hex } from './auth/crypto.js';
import type { McpCallLog, McpOAuthStore, PreviewSessionRecord } from './store.js';

/**
 * Sessão de navegador SOMENTE LEITURA para o agente (escopo `designer.preview`).
 *
 * Problema: o editor exige login e o agente não digita senha. Solução: a ferramenta `start_frontend_session` devolve uma URL
 * com um CÓDIGO DE USO ÚNICO (~60 s). A página `/mcp/entrar` do frontend troca o código (POST /api/mcp/preview/exchange)
 * por um token de sessão opaco (`mcpv_...`) que ela guarda como o cookie `auth_token`. O token vale 2 h FIXAS, só lê e só
 * enxerga as marcas da conexão (a trava vive em `middleware/previewSession.ts`, dentro do `requireAuth`).
 *
 * Invariantes que os testes cobrem:
 *  - código: uso único e atômico (`takeOnce`), vida de 60 s; só o hash vai para o Redis;
 *  - UMA sessão ativa por conexão: cada pedido novo ENCERRA o anterior (decisão: encerrar, e não recusar, para que um agente
 *    que travou no meio não deixe a conexão presa por 2 h). Em corrida, vence o último ponteiro gravado (`gen`);
 *  - a sessão morre por tempo (2 h, sem renovação), por `end_frontend_session`, por pedido novo ou ao revogar a conexão;
 *  - o token e o código nunca entram em log nem em mensagem de erro.
 */

/** Vida do código de entrada, em segundos. */
export const PREVIEW_CODE_TTL_SEC = 60;
/** Vida da sessão, em segundos. Fixa: não há renovação. */
export const PREVIEW_SESSION_TTL_SEC = 2 * 60 * 60;
/** Prefixo do token de sessão: reconhecível em log/scanner e distinto do JWT do app. */
export const PREVIEW_TOKEN_PREFIX = 'mcpv_';
/** Folga que o registro da sessão sobrevive ao prazo: quem usa o token vencido recebe o 401 e o rastro anota `expired`. */
const PREVIEW_EXPIRY_GRACE_SEC = 5 * 60;

/** Teto de pedidos de sessão por conexão (cada um encerra o anterior; isto freia um agente em laço). */
export const PREVIEW_START_RATE_LIMIT = { windowSec: 10 * 60, max: 6, keyPrefix: 'mcp-preview-start' } as const;

export type PreviewEndReason = 'ended_by_agent' | 'replaced' | 'revoked' | 'expired';

/** Contexto que `requireAuth` recebe de uma sessão válida. */
export interface PreviewSessionContext {
  userId: string;
  familyId: string;
  clientId: string;
  expiresAt: number;
  /** Primeiros caracteres do hash: identifica a sessão em log sem permitir o reuso dela. */
  sessionRef: string;
  /** 'all' = as marcas de agora do usuário; 'selected' = só estas. */
  brandMode: 'all' | 'selected';
  brandIds: string[];
}

export interface StartedPreviewSession {
  /** Código em claro: ÚNICA vez que existe fora do hash. Quem chama monta a URL e não o registra. */
  code: string;
  expiresAt: number;
  codeExpiresAt: number;
}

export interface ExchangedPreviewSession {
  token: string;
  expiresAt: number;
  userId: string;
  familyId: string;
}

export class PreviewService {
  constructor(
    private readonly store: McpOAuthStore,
    private readonly callLog: McpCallLog,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cria um código de entrada para a conexão, encerrando a sessão anterior dela (se houver). */
  async start(params: { userId: string; familyId: string; clientId: string }): Promise<StartedPreviewSession> {
    const { userId, familyId, clientId } = params;
    const now = this.now();

    const previous = await this.store.getPreviewPointer(familyId);
    if (previous) await this.dropPointer(familyId, previous, { userId, clientId }, 'replaced');

    const gen = randomSecret(16);
    const code = randomSecret(32);
    const codeHash = sha256Hex(code);
    const expiresAt = now + PREVIEW_SESSION_TTL_SEC * 1000;

    await this.store.savePreviewCode(codeHash, { familyId, userId, clientId, gen, createdAt: now, expiresAt }, PREVIEW_CODE_TTL_SEC);
    // Ponteiro por último: só depois dele o código vale. O TTL cobre sessão inteira + a folga do código.
    await this.store.setPreviewPointer(
      familyId,
      { gen, codeHash, startedAt: now, expiresAt },
      PREVIEW_SESSION_TTL_SEC + PREVIEW_CODE_TTL_SEC,
    );

    await this.record('frontend_session.started', { userId, clientId, familyId });
    return { code, expiresAt, codeExpiresAt: now + PREVIEW_CODE_TTL_SEC * 1000 };
  }

  /**
   * Troca o código pelo token de sessão. Qualquer falha devolve `null`, sem distinguir o motivo (usado, vencido, inventado,
   * de sessão substituída ou de conexão revogada): quem chama não aprende nada sobre códigos alheios.
   */
  async exchange(code: string): Promise<ExchangedPreviewSession | null> {
    const now = this.now();
    // Consome ANTES de qualquer outra checagem: um código inválido por outro motivo também fica queimado.
    const record = await this.store.consumePreviewCode(sha256Hex(code));
    if (!record) return null;
    if (now - record.createdAt > PREVIEW_CODE_TTL_SEC * 1000) return null;
    if (record.expiresAt <= now) return null;

    const pointer = await this.store.getPreviewPointer(record.familyId);
    if (!pointer || pointer.gen !== record.gen) return null;
    if (!(await this.store.getFamily(record.familyId))) return null;

    const token = PREVIEW_TOKEN_PREFIX + randomSecret(32);
    const tokenHash = sha256Hex(token);
    const ttlSec = Math.max(1, Math.floor((record.expiresAt - now) / 1000)) + PREVIEW_EXPIRY_GRACE_SEC;
    await this.store.savePreviewSession(
      tokenHash,
      {
        familyId: record.familyId,
        userId: record.userId,
        clientId: record.clientId,
        gen: record.gen,
        createdAt: record.createdAt,
        usedAt: now,
        expiresAt: record.expiresAt,
      },
      ttlSec,
    );

    // Anota o hash da sessão no ponteiro, se ele ainda for o desta geração (outro pedido pode ter chegado no meio).
    const latest = await this.store.getPreviewPointer(record.familyId);
    if (latest && latest.gen === record.gen) {
      await this.store.setPreviewPointer(record.familyId, { ...latest, sessionHash: tokenHash }, ttlSec + PREVIEW_CODE_TTL_SEC);
    }

    await this.record('frontend_session.used', { userId: record.userId, clientId: record.clientId, familyId: record.familyId });
    return { token, expiresAt: record.expiresAt, userId: record.userId, familyId: record.familyId };
  }

  /** `requireAuth`: o token é uma sessão viva? `null` = não (e a sessão vencida/substituída é limpa). */
  async authenticate(token: string): Promise<PreviewSessionContext | null> {
    if (!token.startsWith(PREVIEW_TOKEN_PREFIX)) return null;
    const tokenHash = sha256Hex(token);
    const session = await this.store.getPreviewSession(tokenHash);
    if (!session) return null;

    if (session.expiresAt <= this.now()) {
      await this.discard(tokenHash, session, 'expired');
      return null;
    }
    // Substituída por um pedido novo (ou encerrada): o ponteiro deixou de apontar para esta geração.
    const pointer = await this.store.getPreviewPointer(session.familyId);
    if (!pointer || pointer.gen !== session.gen) {
      await this.store.deletePreviewSession(tokenHash);
      return null;
    }
    // Revogar a conexão (por qualquer caminho: tela, reuso de refresh, /revoke) derruba a sessão na requisição seguinte.
    const family = await this.store.getFamily(session.familyId);
    if (!family) {
      await this.discard(tokenHash, session, 'revoked');
      return null;
    }

    return {
      userId: session.userId,
      familyId: session.familyId,
      clientId: session.clientId,
      expiresAt: session.expiresAt,
      sessionRef: tokenHash.slice(0, 12),
      brandMode: family.brandMode === 'all' ? 'all' : 'selected',
      brandIds: family.brandIds,
    };
  }

  /** `end_frontend_session` e a revogação da conexão. Idempotente: `false` quando não havia sessão. */
  async endForFamily(
    familyId: string,
    meta: { userId: string; clientId: string },
    reason: Exclude<PreviewEndReason, 'replaced' | 'expired'>,
  ): Promise<boolean> {
    const pointer = await this.store.getPreviewPointer(familyId);
    if (!pointer) return false;
    await this.dropPointer(familyId, pointer, meta, reason);
    return true;
  }

  private async dropPointer(
    familyId: string,
    pointer: { codeHash: string; sessionHash?: string },
    meta: { userId: string; clientId: string },
    reason: PreviewEndReason,
  ): Promise<void> {
    await this.store.deletePreviewCode(pointer.codeHash);
    if (pointer.sessionHash) await this.store.deletePreviewSession(pointer.sessionHash);
    await this.store.deletePreviewPointer(familyId);
    await this.record('frontend_session.ended', { ...meta, familyId }, reason);
  }

  private async discard(tokenHash: string, session: PreviewSessionRecord, reason: PreviewEndReason): Promise<void> {
    await this.store.deletePreviewSession(tokenHash);
    const pointer = await this.store.getPreviewPointer(session.familyId);
    if (pointer && pointer.gen === session.gen) await this.store.deletePreviewPointer(session.familyId);
    await this.record('frontend_session.ended', { userId: session.userId, clientId: session.clientId, familyId: session.familyId }, reason);
  }

  /** Rastro no mesmo registro das chamadas do MCP (`user:<id>`): quem, quando, de qual conexão. Nunca derruba o fluxo. */
  private async record(
    tool: 'frontend_session.started' | 'frontend_session.used' | 'frontend_session.ended',
    who: { userId: string; clientId: string; familyId: string },
    reason?: PreviewEndReason,
  ): Promise<void> {
    const event = {
      ts: new Date(this.now()).toISOString(),
      userId: who.userId,
      clientId: who.clientId,
      familyId: who.familyId,
      tool,
      ok: true,
      ...(reason ? { errorCode: reason } : {}),
      durationMs: 0,
    };
    try {
      await this.callLog.appendCall(`user:${who.userId}`, event);
    } catch (err) {
      logger.warn('mcp.call_log_failed', { error: err instanceof Error ? err.message : String(err) });
    }
    logger.info('mcp.preview', { tool, userId: who.userId, clientId: who.clientId, familyId: who.familyId, reason });
  }
}
