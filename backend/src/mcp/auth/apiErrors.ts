import type { ErrorRequestHandler } from 'express';
import { logger } from '../../lib/logger.js';

/**
 * Tratamento de erro da API do usuário do conector (`/api/mcp/*`).
 *
 * O `errorHandler` global do app devolve `err.message` ao cliente em QUALQUER status. Para
 * um erro de validação nosso (`createError(400, ...)`) isso é o desejado; para uma falha
 * de infraestrutura é um vazamento: um Redis sem um comando chegaria ao navegador do
 * usuário como `ERR unknown command 'getdel', with args beginning with: ...`, entregando
 * versão, comando e chave. Este handler fica DEPOIS do roteador do conector e separa os dois:
 *
 *  - erro com status 4xx (criado por nós, ou do parser de corpo): segue para o handler
 *    global, que já formata `{ error: { message, code } }` — a mensagem é nossa;
 *  - qualquer outra coisa (Redis, Prisma, bug): mensagem GENÉRICA ao cliente e o detalhe
 *    só no log. Sem stack e sem `err.message` na resposta, nem em desenvolvimento.
 */
export const mcpApiErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status: unknown = err?.statusCode ?? err?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return next(err);

  logger.error('mcp.api_error', {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    error: {
      message: 'Erro interno ao processar a solicitação. Tente novamente em instantes.',
      code: 'MCP_INTERNAL_ERROR',
    },
  });
};
