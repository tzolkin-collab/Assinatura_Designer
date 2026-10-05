import type { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { createError } from './errorHandler.js';
import type { AuthRequest } from './auth.js';

// Rate limiter de janela fixa, apoiado no Redis (funciona entre processos, ao
// contrário de um contador em memória). Usado para frear brute-force em
// login/registro. Fail-open: se o Redis estiver fora, NÃO bloqueia requisições
// legítimas — segurança não deve derrubar o login por indisponibilidade da fila.
export function rateLimit(opts: { windowSec: number; max: number; keyPrefix: string; keyBy?: 'ip' | 'user' }) {
  const { windowSec, max, keyPrefix, keyBy = 'ip' } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // `keyBy: 'user'` é para rotas que já passaram por requireAuth (todas as que usam
      // isto hoje: login/registro são por IP mesmo, mas as de sanitização de SVG abaixo
      // precisam identificar a CONTA — o recurso que protegem, o pool de worker_threads
      // de svgSanitize.ts, é compartilhado pelo PROCESSO inteiro, e o ataque catalogado é
      // "uma conta manda muita coisa de uma vez", não brute-force anônimo. IP sozinho
      // erraria o alvo dos dois lados: várias contas atrás do mesmo NAT/proxy corporativo
      // dividiriam o mesmo balde (throttle injusto para quem não abusou), e nada impede a
      // MESMA conta de continuar mandando do mesmo IP (não é o IP que precisa ser freado).
      // Cai para IP se por algum motivo `req.user` não estiver populado (não deveria
      // acontecer nas rotas atuais, todas atrás de requireAuth antes deste middleware) —
      // melhor um balde por IP do que juntar todo mundo sem conta num balde só.
      const userId = keyBy === 'user' ? (req as AuthRequest).user?.userId : undefined;
      const identity = userId ?? `ip:${(req.ip || req.socket.remoteAddress || 'unknown').toString()}`;
      const key = `ratelimit:${keyPrefix}:${identity}`;

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
