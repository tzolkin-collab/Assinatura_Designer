import { z } from 'zod';

// Desdobramento / collab (Cérebro de IA, §1.1.3 e §9).
//
// Uma marca derivada de um projeto-base. Nunca nasce com identidade própria do zero: herda a
// base e guarda só o que muda. Dois tipos:
//   - INTERNAL: contexto, objetivo, público e campanha específicos, sem marca parceira.
//   - PARTNERSHIP: marca parceira (logo + imagem do guia visual) e nível de protagonismo.
//
// Protagonismo é força narrativa e visual, não divisão rígida de área: 50 equilibra os dois
// universos sem criar uma terceira identidade, 70 mantém a base claramente reconhecível.

export const COLLAB_KINDS = ['INTERNAL', 'PARTNERSHIP'] as const;
export type CollabKind = (typeof COLLAB_KINDS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

// Só https: o servidor carrega estas imagens (raster do slide), então `javascript:`, `file:` e
// afins nem chegam à rota. A rota ainda exige que o arquivo esteja na biblioteca da base.
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Use um endereço https.');
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const collabDetailsSchema = z.object({
  /** O que este desdobramento é e para que serve. */
  context: optionalText(2000),
  objective: optionalText(1000),
  audience: optionalText(500),
  /** Produto ou campanha específica, quando houver. */
  campaign: optionalText(500),
  partner: z
    .object({
      name: text(120),
      logoUrl: httpsUrl.optional(),
      /** Imagem do manual/guia visual do parceiro. */
      visualManualUrl: httpsUrl.optional(),
    })
    .optional(),
  /** % da narrativa e da identidade que fica com a marca-base (0 a 100). */
  baseProtagonism: z.number().int().min(0).max(100).optional(),
});

export type CollabDetails = z.infer<typeof collabDetailsSchema>;

export const createCollabSchema = z
  .object({
    name: text(80),
    kind: z.enum(COLLAB_KINDS),
    color: z.string().max(20).optional(),
    details: collabDetailsSchema.default({}),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'PARTNERSHIP') {
      if (!value.details.partner) {
        ctx.addIssue({ code: 'custom', path: ['details', 'partner'], message: 'Parceria exige o parceiro (nome e, de preferência, logo e guia visual).' });
      }
      if (value.details.baseProtagonism === undefined) {
        ctx.addIssue({ code: 'custom', path: ['details', 'baseProtagonism'], message: 'Parceria exige o nível de protagonismo da marca-base (0 a 100).' });
      }
    } else if (value.details.partner || value.details.baseProtagonism !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Desdobramento interno não tem parceiro nem protagonismo.' });
    }
  });

export type CreateCollabInput = z.infer<typeof createCollabSchema>;

const slugify = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

/** Slug do desdobramento: prefixado pelo da base, para não colidir com marcas de nome igual. */
export function collabSlug(parentSlug: string, name: string): string {
  const own = slugify(name);
  return own ? `${parentSlug}-${own}` : `${parentSlug}-desdobramento`;
}
