// Importação da ficha a partir de um manual: o que a IA devolve vira RASCUNHO no formulário.
//
// Regras:
//   - só campo vazio é preenchido; o que a pessoa já escreveu nunca é sobrescrito sozinho;
//   - quando o manual traz algo diferente do que já está lá, vira "conflito" e a pessoa escolhe;
//   - nada é salvo aqui: o formulário fica "com alterações" e quem aprova é a pessoa, ao salvar.
//
// Função pura, para testar sem montar a página.

import { profileToForm, type BrandProfile, type ProfileFormState } from './profileForm';

export interface ProfileEvidence {
  label?: string;
  quote: string;
  page?: number;
}

export type ProfileImportStatus = 'ok' | 'partial' | 'failed';

export interface ProfileImportResult {
  draft: BrandProfile;
  evidence: Record<string, ProfileEvidence[]>;
  notFound: string[];
  warnings: string[];
  status: ProfileImportStatus;
  reason?: string;
  quotesChecked: boolean;
}

type FormKey = keyof ProfileFormState;

/** Seção da ficha → campos do formulário que ela ocupa. Logo e manual visual só levam as regras: arquivos vêm da biblioteca. */
const SECTION_FIELDS: Record<string, { title: string; keys: FormKey[] }> = {
  essence: { title: 'Essência e posicionamento', keys: ['essence'] },
  writingDirection: { title: 'Tom e direção de escrita', keys: ['writingDirection'] },
  palette: { title: 'Paleta', keys: ['palette'] },
  typography: { title: 'Tipografia', keys: ['typography'] },
  logo: { title: 'Logo e assinatura (regras de uso)', keys: ['logoRules'] },
  artDirection: { title: 'Direção de arte', keys: ['artDirection'] },
  realPhoto: { title: 'Fotografia real', keys: ['realPhoto'] },
  graphicElements: { title: 'Elementos gráficos', keys: ['graphicElements'] },
  neverDo: { title: 'O que nunca fazer', keys: ['neverDo'] },
  approvalCriterion: { title: 'Critério de aprovação', keys: ['approvalCriterion'] },
  brandCodes: { title: 'Códigos que não podem sumir', keys: ['brandCodes'] },
  variation: { title: 'O que pode variar e o que precisa ficar', keys: ['mayVary', 'mustKeep'] },
  collabRules: { title: 'Regras de collab', keys: ['collabRules'] },
};

export const SECTION_TITLES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SECTION_FIELDS).map(([k, v]) => [k, v.title])),
  visualManual: 'Manual visual',
};

const isEmptyValue = (v: unknown): boolean => (Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim() === '' : !v);

const sectionEmpty = (form: ProfileFormState, keys: FormKey[]) => keys.every((k) => isEmptyValue(form[k]));
const sectionSuggestion = (suggested: ProfileFormState, keys: FormKey[]) => keys.filter((k) => !isEmptyValue(suggested[k]));

export interface ImportConflict {
  section: string;
  title: string;
  /** Campos do formulário que a sugestão trocaria, já com os valores propostos. */
  patch: Partial<ProfileFormState>;
}

export interface MergeOutcome {
  form: ProfileFormState;
  /** Seções que estavam vazias e foram preenchidas. */
  applied: string[];
  /** Seções com texto/valores que a pessoa já tinha e que o manual diz de outro jeito. */
  conflicts: ImportConflict[];
}

/** Os valores propostos para uma seção, só dos campos que o manual realmente trouxe. */
function patchFor(suggested: ProfileFormState, keys: FormKey[]): Partial<ProfileFormState> {
  const patch: Partial<ProfileFormState> = {};
  for (const k of sectionSuggestion(suggested, keys)) (patch as Record<string, unknown>)[k] = suggested[k];
  return patch;
}

export function mergeDraftIntoForm(form: ProfileFormState, draft: BrandProfile): MergeOutcome {
  const suggested = profileToForm(draft);
  let next = form;
  const applied: string[] = [];
  const conflicts: ImportConflict[] = [];

  for (const [section, { title, keys }] of Object.entries(SECTION_FIELDS)) {
    const patch = patchFor(suggested, keys);
    if (Object.keys(patch).length === 0) continue; // o manual não trouxe nada desta seção
    if (sectionEmpty(form, keys)) {
      next = { ...next, ...patch };
      applied.push(section);
    } else if (JSON.stringify(Object.keys(patch).map((k) => form[k as FormKey])) !== JSON.stringify(Object.keys(patch).map((k) => suggested[k as FormKey]))) {
      conflicts.push({ section, title, patch });
    }
  }
  return { form: next, applied, conflicts };
}

/** Aceitar a sugestão de um conflito: troca só os campos daquela seção. */
export function applyConflict(form: ProfileFormState, conflict: ImportConflict): ProfileFormState {
  return { ...form, ...conflict.patch };
}

/** O resumo do que a importação fez, em português claro. */
export function importSummary(result: ProfileImportResult, outcome: MergeOutcome): string {
  if (result.status === 'failed') return result.reason || 'Não consegui ler o manual.';
  const filled = outcome.applied.length;
  const parts = [filled === 0 ? 'Nenhum campo vazio foi preenchido' : `${filled} ${filled === 1 ? 'campo preenchido' : 'campos preenchidos'}`];
  if (outcome.conflicts.length) parts.push(`${outcome.conflicts.length} ${outcome.conflicts.length === 1 ? 'diferença' : 'diferenças'} com o que já estava na ficha`);
  return `${parts.join('; ')}.`;
}
