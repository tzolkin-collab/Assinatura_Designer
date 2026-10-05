import {
  COLLAB_MODE_PROMPT,
  GLOBAL_BRAIN_PROMPT,
  MODE_EBOOK_A4_PROMPT,
  MODE_PRESENTATION_PROMPT,
  MODE_SINGLE_IMAGE_PROMPT,
  REAL_PHOTO_RULE_PROMPT,
} from './prompts.js';
import { renderTextBlocks } from './textStatus.js';
import type {
  AssembleInput,
  AssembledBrain,
  BrainAsset,
  ProductionMode,
  PromptSection,
} from './types.js';

// Montagem do cérebro em camadas. Função PURA: recebe só o projeto ativo (e o collab, se
// houver) e devolve o prompt. Não lê banco nem tem estado — é isso que garante o
// isolamento (Teste 6): o que não é passado aqui não existe para o modelo.
//
// Ordem de envio (§16): global → projeto-base → collab → modo → regra de foto → ativos →
// briefing → checklist de revisão. Essa é a ordem de MONTAGEM; a ordem de PRIORIDADE em
// conflito (§6.1: texto aprovado > global > projeto > collab > modo > ativos > peça) é
// outra coisa e é dita ao modelo pelo próprio texto dos prompts.

const MODE_PROMPTS: Record<ProductionMode, string> = {
  presentation: MODE_PRESENTATION_PROMPT,
  'single-image': MODE_SINGLE_IMAGE_PROMPT,
  'ebook-a4': MODE_EBOOK_A4_PROMPT,
};

/**
 * Itens da revisão obrigatória, na ordem do §3.1 item 9. O teste confere que cada um
 * continua presente no prompt global, para as duas listas não se afastarem.
 */
export const REVIEW_CHECKLIST_ITEMS = [
  'ordem',
  'quantidade',
  'texto',
  'acentos',
  'nomes',
  'datas',
  'valores',
  'logos',
  'fontes',
  'cores',
  'proporções',
  'margens',
  'legibilidade',
  'imagens',
  'cortes',
  'continuidade',
  'coerência com o projeto',
  'ausência de conteúdo inventado',
] as const;

const ASSET_ROLE_LABEL: Record<BrainAsset['role'], string> = {
  logo: 'Logo',
  icon: 'Ícone',
  palette: 'Paleta',
  font: 'Fonte',
  'visual-manual': 'Manual visual',
  photo: 'Foto real',
  reference: 'Referência',
  other: 'Ativo',
};

function renderAssets(origin: string, assets: BrainAsset[] | undefined): string[] {
  return (assets ?? []).map((a) => `- [${origin}] ${ASSET_ROLE_LABEL[a.role]}: ${a.name} (${a.url})`);
}

function renderCollab(input: NonNullable<AssembleInput['collab']>): string {
  const kind = input.kind === 'internal' ? 'INTERNO' : 'PARCERIA / COLLAB';
  const lines = [COLLAB_MODE_PROMPT, '', `DESDOBRAMENTO ATIVO: ${input.name} (${kind})`];
  if (input.kind === 'partnership' && input.leadPercent !== undefined) {
    lines.push(`PROTAGONISMO: a marca-mãe lidera com ${input.leadPercent}%.`);
  }
  lines.push(input.memory);
  return lines.join('\n');
}

function renderBriefing(creation: AssembleInput['creation']): string {
  const parts: string[] = [];
  const text = renderTextBlocks(creation.blocks);
  if (text) parts.push(text);
  const facts: string[] = [];
  if (creation.pageCount !== undefined) facts.push(`QUANTIDADE FECHADA: ${creation.pageCount}`);
  if (creation.aspectRatio) facts.push(`PROPORÇÃO: ${creation.aspectRatio}`);
  if (facts.length > 0) parts.push(facts.join('\n'));
  if (creation.instruction?.trim()) parts.push(`INSTRUÇÃO ESPECÍFICA DA PEÇA:\n${creation.instruction.trim()}`);
  return parts.join('\n\n');
}

function renderReview(): string {
  return `REVISÃO OBRIGATÓRIA — antes de entregar, confira: ${REVIEW_CHECKLIST_ITEMS.join(', ')}. Só considere a saída final quando essas verificações estiverem atendidas.`;
}

/** §13 — lista objetiva do que falta. Nada aqui é preenchido com invenção. */
function findPending(input: AssembleInput): string[] {
  const pending: string[] = [];
  if (!input.project.name.trim()) pending.push('Nome do projeto/marca-mãe');
  if (!input.project.memory.trim()) pending.push('Memória do projeto-base');
  const { creation, collab } = input;
  if (creation.mode === 'single-image' && !creation.aspectRatio) {
    pending.push('Proporção da imagem avulsa (1:1, 4:5, 9:16 ou outra)');
  }
  if (creation.mode === 'presentation' && creation.pageCount === undefined) {
    pending.push('Número total de slides');
  }
  if (collab && !collab.memory.trim()) pending.push('Contexto do desdobramento/collab');
  if (collab?.kind === 'partnership' && collab.leadPercent === undefined) {
    pending.push('Percentual de protagonismo da marca-mãe no collab');
  }
  return pending;
}

export function assembleDesignerBrain(input: AssembleInput): AssembledBrain {
  const { project, collab, creation } = input;
  const sections: PromptSection[] = [];

  sections.push({ id: 'global', text: GLOBAL_BRAIN_PROMPT });
  sections.push({ id: 'project', text: project.memory });
  if (collab) sections.push({ id: 'collab', text: renderCollab(collab) });
  sections.push({ id: 'mode', text: MODE_PROMPTS[creation.mode] });

  // §5.1 — anexada automaticamente a todo pedido com fotografia ou área fotográfica.
  const allAssets = [
    ...renderAssets('projeto', project.assets),
    ...renderAssets('collab', collab?.assets),
    ...renderAssets('demanda', creation.assets),
  ];
  const hasPhotoAsset = [project.assets, collab?.assets, creation.assets].some((list) =>
    (list ?? []).some((a) => a.role === 'photo'),
  );
  if (creation.hasPhotoOrPhotoArea || hasPhotoAsset) {
    sections.push({ id: 'photo-rule', text: REAL_PHOTO_RULE_PROMPT });
  }

  if (allAssets.length > 0) {
    sections.push({ id: 'assets', text: `ATIVOS REAIS DISPONÍVEIS:\n${allAssets.join('\n')}` });
  }

  const briefing = renderBriefing(creation);
  if (briefing) sections.push({ id: 'briefing', text: briefing });

  sections.push({ id: 'review', text: renderReview() });

  return {
    sections,
    prompt: sections.map((s) => s.text).join('\n\n'),
    pending: findPending(input),
  };
}
