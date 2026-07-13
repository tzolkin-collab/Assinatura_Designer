import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { runWithAiContext } from '../lib/aiContext.js';
import { logger } from '../lib/logger.js';

/**
 * Abre o contexto da requisição, com um `requestId` que amarra todas as linhas de
 * log de uma mesma chamada. Sem ele, depurar produção era ler `console.log` solto e
 * adivinhar o que era de quem quando duas gerações rodavam ao mesmo tempo.
 *
 * Roda antes de tudo, então ainda não há usuário nem marca: o `auth` e o
 * `requireBrandRole` completam o contexto quando descobrem quem é (enrichAiContext).
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', requestId);

  runWithAiContext({ requestId, feature: 'http' }, () => {
    const inicio = Date.now();

    res.on('finish', () => {
      const duracaoMs = Date.now() - inicio;
      const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[nivel]('HTTP', {
        method: req.method,
        path: req.originalUrl.split('?')[0], // querystring pode levar token
        status: res.statusCode,
        durationMs: duracaoMs,
      });
    });

    next();
  });
}
