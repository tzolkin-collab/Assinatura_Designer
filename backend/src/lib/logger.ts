import { config } from '../config.js';
import { getAiContext } from './aiContext.js';

/**
 * Log estruturado.
 *
 * Antes era só `console.log` solto: depurar uma geração que falhou em produção
 * virava chute, porque nada amarrava as linhas de uma mesma sessão nem dizia de
 * qual marca era o erro. Aqui toda linha sai com nível, timestamp e o contexto
 * (sessão, marca, requestId) que o `aiContext` já carrega.
 *
 * Em produção sai JSON (uma linha por evento, pronto para qualquer coletor). Em
 * dev sai legível para humano.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configurado = (process.env.LOG_LEVEL ?? (config.isDev ? 'debug' : 'info')) as LogLevel;
  return LEVEL_ORDER[configurado] ?? LEVEL_ORDER.info;
}

type Fields = Record<string, unknown>;

function limpar(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null));
}

function emitir(level: LogLevel, message: string, fields: Fields = {}): void {
  if (LEVEL_ORDER[level] < minLevel()) return;

  const { requestId, sessionId, brandSlug, feature } = getAiContext();
  const payload = limpar({
    level,
    time: new Date().toISOString(),
    message,
    requestId,
    sessionId,
    brandSlug,
    feature,
    ...fields,
  });

  const escrever = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (config.isDev) {
    const contexto = limpar({ requestId, sessionId, brandSlug, feature, ...fields });
    const extras = Object.entries(contexto)
      .filter(([k]) => !['level', 'time', 'message'].includes(k))
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' ');
    escrever(`[${level}] ${message}${extras ? ` · ${extras}` : ''}`);
    return;
  }

  escrever(JSON.stringify(payload));
}

export const logger = {
  debug: (message: string, fields?: Fields) => emitir('debug', message, fields),
  info: (message: string, fields?: Fields) => emitir('info', message, fields),
  warn: (message: string, fields?: Fields) => emitir('warn', message, fields),
  error: (message: string, fields?: Fields) => emitir('error', message, fields),
};
