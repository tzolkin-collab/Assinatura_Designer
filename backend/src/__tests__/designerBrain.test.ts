import { describe, it, expect } from 'vitest';
import {
  AMANDA_COELHO_MEMORY,
  COLLAB_MODE_PROMPT,
  GLOBAL_BRAIN_PROMPT,
  MODE_EBOOK_A4_PROMPT,
  MODE_PRESENTATION_PROMPT,
  MODE_SINGLE_IMAGE_PROMPT,
  REAL_PHOTO_RULE_PROMPT,
  REVIEW_CHECKLIST_ITEMS,
  assembleDesignerBrain,
  canBeFinal,
  type AssembleInput,
} from '../lib/designerBrain';

const AMANDA: AssembleInput['project'] = { name: 'Amanda Coelho', memory: AMANDA_COELHO_MEMORY };
const OUTRA: AssembleInput['project'] = {
  name: 'Marca Teste',
  memory: 'PROJETO ATIVO: MARCA TESTE\nPALETA OFICIAL\n#112233 azul teste.',
};

function presentation(extra: Partial<AssembleInput['creation']> = {}): AssembleInput['creation'] {
  return { mode: 'presentation', pageCount: 5, blocks: [], ...extra };
}

describe('textos do cérebro (copiados do documento)', () => {
  it('o prompt global não carrega identidade de nenhum projeto', () => {
    expect(GLOBAL_BRAIN_PROMPT).not.toMatch(/Amanda/i);
    expect(GLOBAL_BRAIN_PROMPT).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it('o prompt global traz as regras que protegem o resultado', () => {
    expect(GLOBAL_BRAIN_PROMPT).toContain('FOTOGRAFIA REAL — REGRA ABSOLUTA');
    expect(GLOBAL_BRAIN_PROMPT).toContain('Preserve literalmente textos marcados como aprovados.');
    expect(GLOBAL_BRAIN_PROMPT).toContain('9. REVISÃO OBRIGATÓRIA');
  });

  it('a lista de revisão continua toda presente no prompt global', () => {
    const revisao = GLOBAL_BRAIN_PROMPT.split('9. REVISÃO OBRIGATÓRIA')[1]!.toLowerCase();
    for (const item of REVIEW_CHECKLIST_ITEMS) expect(revisao).toContain(item);
  });

  it('a memória da Amanda traz a paleta oficial e as fontes', () => {
    for (const hex of ['#410C1C', '#8E242E', '#D8E9F3', '#FCF9EB']) {
      expect(AMANDA_COELHO_MEMORY).toContain(hex);
    }
    expect(AMANDA_COELHO_MEMORY).toContain('Queens');
    expect(AMANDA_COELHO_MEMORY).toContain('Aeonik');
  });

  it('cada modo tem seu próprio texto e eles não se misturam', () => {
    expect(MODE_PRESENTATION_PROMPT).toContain('MODO: APRESENTAÇÃO');
    expect(MODE_SINGLE_IMAGE_PROMPT).toContain('MODO: IMAGEM AVULSA');
    expect(MODE_EBOOK_A4_PROMPT).toContain('MODO: E-BOOK');
    expect(MODE_PRESENTATION_PROMPT).not.toContain('MODO: E-BOOK');
  });
});

describe('montagem em camadas', () => {
  it('segue a ordem do §16', () => {
    const out = assembleDesignerBrain({
      project: { ...AMANDA, assets: [{ name: 'logo.png', url: 'u1', role: 'logo' }] },
      collab: { name: 'Mentoria', kind: 'internal', memory: 'Contexto da mentoria.' },
      creation: presentation({
        hasPhotoOrPhotoArea: true,
        instruction: 'Fechar com impacto.',
        blocks: [{ status: 'approved', text: 'Texto final.' }],
      }),
    });
    expect(out.sections.map((s) => s.id)).toEqual([
      'global',
      'project',
      'collab',
      'mode',
      'photo-rule',
      'assets',
      'briefing',
      'review',
    ]);
  });

  it('o prompt final começa pelo global e termina pela revisão', () => {
    const out = assembleDesignerBrain({ project: AMANDA, creation: presentation() });
    expect(out.prompt.startsWith(GLOBAL_BRAIN_PROMPT)).toBe(true);
    expect(out.sections.at(-1)!.id).toBe('review');
  });

  it('sem collab, a camada de collab não existe', () => {
    const out = assembleDesignerBrain({ project: AMANDA, creation: presentation() });
    expect(out.sections.some((s) => s.id === 'collab')).toBe(false);
    expect(out.prompt).not.toContain(COLLAB_MODE_PROMPT);
  });

  it('o collab guarda só o que muda e informa o protagonismo', () => {
    const out = assembleDesignerBrain({
      project: AMANDA,
      collab: { name: 'Amanda + Parceiro', kind: 'partnership', leadPercent: 70, memory: 'Parceiro: X.' },
      creation: presentation(),
    });
    const collab = out.sections.find((s) => s.id === 'collab')!.text;
    expect(collab).toContain(COLLAB_MODE_PROMPT);
    expect(collab).toContain('PROTAGONISMO: a marca-mãe lidera com 70%.');
    expect(collab).toContain('Parceiro: X.');
    // O projeto-base entra uma vez só, na própria camada — não é duplicado no collab.
    expect(out.prompt.split(AMANDA_COELHO_MEMORY).length - 1).toBe(1);
  });
});

describe('isolamento entre projetos (Teste 6)', () => {
  it('outro projeto não recebe nada da Amanda', () => {
    const out = assembleDesignerBrain({ project: OUTRA, creation: presentation() });
    for (const hex of ['#410C1C', '#8E242E', '#D8E9F3', '#FCF9EB']) expect(out.prompt).not.toContain(hex);
    expect(out.prompt).not.toContain('Queens');
    expect(out.prompt).not.toContain('Aeonik');
    expect(out.prompt).toContain('#112233');
  });

  it('sair do collab não deixa rastro no próximo pedido', () => {
    const comCollab = assembleDesignerBrain({
      project: AMANDA,
      collab: { name: 'Estadão', kind: 'partnership', leadPercent: 50, memory: 'MARCADOR-DO-COLLAB' },
      creation: presentation(),
    });
    const semCollab = assembleDesignerBrain({ project: AMANDA, creation: presentation() });
    expect(comCollab.prompt).toContain('MARCADOR-DO-COLLAB');
    expect(semCollab.prompt).not.toContain('MARCADOR-DO-COLLAB');
  });
});

describe('regra de foto real (§5.1)', () => {
  it('só é anexada quando há foto ou área fotográfica', () => {
    const sem = assembleDesignerBrain({ project: AMANDA, creation: presentation() });
    const com = assembleDesignerBrain({ project: AMANDA, creation: presentation({ hasPhotoOrPhotoArea: true }) });
    expect(sem.prompt).not.toContain(REAL_PHOTO_RULE_PROMPT);
    expect(com.prompt).toContain(REAL_PHOTO_RULE_PROMPT);
  });

  it('um ativo do tipo foto também aciona a regra', () => {
    const out = assembleDesignerBrain({
      project: { ...AMANDA, assets: [{ name: 'palco.jpg', url: 'u', role: 'photo' }] },
      creation: presentation(),
    });
    expect(out.sections.some((s) => s.id === 'photo-rule')).toBe(true);
  });
});

describe('status do texto (§4.1, Teste 3)', () => {
  const blocks = [
    { status: 'approved', text: 'TEXTO-APROVADO' },
    { status: 'in-review', text: 'TEXTO-EM-REVISAO' },
    { status: 'speech', text: 'FALA-DA-APRESENTADORA' },
    { status: 'context', text: 'CONTEXTO-INTERNO-DE-NARRATIVA' },
    { status: 'internal', text: 'VALOR-COMERCIAL-INTERNO' },
    { status: 'do-not-show', text: 'PROIBIDO-NA-ARTE' },
  ] as const;

  const out = assembleDesignerBrain({ project: AMANDA, creation: presentation({ blocks: [...blocks] }) });
  const briefing = out.sections.find((s) => s.id === 'briefing')!.text;

  it('texto interno e proibido nunca chega ao modelo', () => {
    expect(out.prompt).not.toContain('VALOR-COMERCIAL-INTERNO');
    expect(out.prompt).not.toContain('PROIBIDO-NA-ARTE');
  });

  it('fala e contexto entram só como orientação, fora do bloco de texto visível', () => {
    const [visivel, orientacao] = briefing.split('ORIENTAÇÃO');
    expect(visivel).toContain('TEXTO-APROVADO');
    expect(visivel).not.toContain('FALA-DA-APRESENTADORA');
    expect(visivel).not.toContain('CONTEXTO-INTERNO-DE-NARRATIVA');
    expect(orientacao).toContain('FALA-DA-APRESENTADORA');
    expect(orientacao).toContain('NÃO é texto da peça');
  });

  it('texto em revisão é rascunho e impede chamar a peça de final', () => {
    expect(briefing).toContain('a peça não pode ser chamada de final');
    expect(canBeFinal([...blocks])).toBe(false);
    expect(canBeFinal([{ status: 'approved', text: 'ok' }])).toBe(true);
  });
});

describe('pendências (§13)', () => {
  it('imagem avulsa sem proporção fica pendente', () => {
    const out = assembleDesignerBrain({ project: AMANDA, creation: { mode: 'single-image', blocks: [] } });
    expect(out.pending).toContain('Proporção da imagem avulsa (1:1, 4:5, 9:16 ou outra)');
  });

  it('apresentação sem número de slides fica pendente', () => {
    const out = assembleDesignerBrain({ project: AMANDA, creation: { mode: 'presentation', blocks: [] } });
    expect(out.pending).toContain('Número total de slides');
  });

  it('collab de parceria sem protagonismo fica pendente', () => {
    const out = assembleDesignerBrain({
      project: AMANDA,
      collab: { name: 'X', kind: 'partnership', memory: 'm' },
      creation: presentation(),
    });
    expect(out.pending).toContain('Percentual de protagonismo da marca-mãe no collab');
  });

  it('projeto sem memória fica pendente em vez de ser preenchido', () => {
    const out = assembleDesignerBrain({ project: { name: 'Vazio', memory: '' }, creation: presentation() });
    expect(out.pending).toContain('Memória do projeto-base');
  });

  it('pedido completo não tem pendência', () => {
    const out = assembleDesignerBrain({ project: AMANDA, creation: presentation() });
    expect(out.pending).toEqual([]);
  });
});
