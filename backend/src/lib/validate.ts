import { z } from 'zod';
import { createError } from '../middleware/errorHandler.js';

/**
 * Valida `body` contra um schema zod e devolve o dado tipado, ou lança um
 * createError(400) com detalhe por campo. Padrão único de validação de corpo das
 * rotas — antes cada handler fazia `req.body as X` e checava campo a campo à mão,
 * deixando input malformado virar erro obscuro (ou default silencioso) lá adiante.
 *
 * A mensagem inclui o caminho do campo (`slideCount: Expected number...`) para que
 * o cliente saiba exatamente o que veio errado.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  throw createError(400, detail);
}
