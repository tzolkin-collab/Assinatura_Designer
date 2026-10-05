import { assembleDesignerBrain } from './assemble.js';
import { PROJECT_MEMORY_SEEDS } from './seeds/index.js';
import type { SectionId } from './types.js';

/**
 * Ponte entre o pipeline e o cérebro em camadas. Devolve o texto que ocupa o lugar do
 * `brandContext` legado (resumo de cores/fontes/diretrizes) para as marcas em que o
 * cérebro está ligado.
 */

/** Marca ligada ao cérebro mas sem memória de projeto: configuração incompleta. */
export class DesignerBrainSetupError extends Error {
  constructor(brandSlug: string) {
    super(
      `O cérebro do Designer está ligado para "${brandSlug}", mas a marca não tem memória de projeto. ` +
        'Cadastre a memória em "Instruções do agente" da marca ou desligue o cérebro para ela.',
    );
    this.name = 'DesignerBrainSetupError';
  }
}

/** Cadastro da marca primeiro; o seed do repositório só entra se o cadastro estiver vazio. */
export function resolveProjectMemory(brandSlug: string, agentPrompt: string | null | undefined): string | null {
  const own = agentPrompt?.trim();
  if (own) return own;
  return PROJECT_MEMORY_SEEDS[brandSlug.trim().toLowerCase()] ?? null;
}

// O briefing e os ativos NÃO entram aqui: o pipeline já entrega o briefing ao planner e
// os ativos da biblioteca ao artista por caminhos próprios. Repetir geraria duas versões.
const SECTIONS_FOR_BRAND_CONTEXT: ReadonlySet<SectionId> = new Set<SectionId>([
  'global',
  'project',
  'mode',
  'photo-rule',
  'review',
]);

export interface PipelineBrainInput {
  brand: { slug: string; name: string; agentPrompt: string | null | undefined };
  format: 'presentation' | 'carousel';
  aspectRatio?: string;
  /** Quantidade pedida no briefing, quando houver. */
  pageCount?: number;
}

export interface PipelineBrainContext {
  brandContext: string;
  /** §13 — o que falta saber. O pipeline registra; não bloqueia nem inventa. */
  pending: string[];
}

export function buildPipelineBrainContext(input: PipelineBrainInput): PipelineBrainContext {
  const memory = resolveProjectMemory(input.brand.slug, input.brand.agentPrompt);
  if (!memory) throw new DesignerBrainSetupError(input.brand.slug);

  // O documento tem 3 modos (apresentação, imagem avulsa, e-book A4); carrossel não tem
  // modo próprio. Cada lâmina do carrossel é uma imagem avulsa com proporção definida.
  const assembled = assembleDesignerBrain({
    project: { name: input.brand.name, memory },
    creation: {
      mode: input.format === 'presentation' ? 'presentation' : 'single-image',
      blocks: [],
      pageCount: input.pageCount,
      aspectRatio: input.format === 'presentation' ? '16:9' : (input.aspectRatio ?? '1:1'),
      // Conservador: a regra de foto real é de segurança, então vale sempre que há dúvida.
      hasPhotoOrPhotoArea: true,
    },
  });

  return {
    brandContext: assembled.sections
      .filter((s) => SECTIONS_FOR_BRAND_CONTEXT.has(s.id))
      .map((s) => s.text)
      .join('\n\n'),
    pending: assembled.pending,
  };
}
