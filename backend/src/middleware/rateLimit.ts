import type { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { createError } from './errorHandler.js';

// Rate limiter de janela fixa, apoiado no Redis (funciona entre processos, ao
// contrário de um contador em memória). Usado para frear brute-force em
// login/registro. Fail-open: se o Redis estiver fora, NÃO bloqueia requisições
// legítimas — segurança não deve derrubar o login por indisponibilidade da fila.
export function rateLimit(opts: { windowSec: number; max: number; keyPrefix: string }) {
  const { windowSec, max, keyPrefix } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
      const key = `ratelimit:${keyPrefix}:${ip}`;

      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      if (count > max) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', String(ttl > 0 ? ttl : windowSec));
        return next(createError(429, 'Muitas tentativas. Tente novamente em instantes.'));
      }

      next();
    } catch {
      next();
    }
  };
}
