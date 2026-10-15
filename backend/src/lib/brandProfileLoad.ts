import { brandProfileSchema, profileCompleteness, type BrandProfileData } from './brandProfile.js';

// Carga de uma ficha pronta (por exemplo, a da Amanda) num projeto. Lógica pura, para o script de
// carga e os testes decidirem do mesmo jeito. Regra: nunca sobrescrever uma ficha que alguém já
// salvou, a não ser que se peça de forma explícita.

export type LoadAction = 'create' | 'overwrite' | 'refuse-exists';

export function planProfileLoad(input: { existing: unknown | null; force: boolean }): LoadAction {
  if (input.existing === null || input.existing === undefined) return 'create';
  return input.force ? 'overwrite' : 'refuse-exists';
}

export interface LoadReport {
  valid: boolean;
  /** Erros do schema, quando inválida. */
  errors: string[];
  data: BrandProfileData | null;
  percent: number;
  ready: boolean;
  /** Seções obrigatórias que continuam pendentes depois da carga. */
  pendingRequired: string[];
}

/** Valida a ficha e diz o que continua faltando, sem preencher nada. */
export function reportProfile(candidate: unknown): LoadReport {
  const parsed = brandProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
      data: null,
      percent: 0,
      ready: false,
      pendingRequired: [],
    };
  }
  const c = profileCompleteness(parsed.data);
  return {
    valid: true,
    errors: [],
    data: parsed.data,
    percent: c.percent,
    ready: c.ready,
    pendingRequired: c.pending.filter((p) => p.required).map((p) => p.label),
  };
}
