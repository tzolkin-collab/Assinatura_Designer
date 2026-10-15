import { describe, it, expect } from 'vitest';
import { emptyForm } from './profileForm';
import { applyConflict, importSummary, mergeDraftIntoForm, type ProfileImportResult } from './profileImport';

const draft = {
  essence: 'Imponente e sofisticada.',
  palette: [{ hex: '#582731', name: 'Vinho' }, { hex: '#233766' }],
  neverDo: ['Evitar poluição visual', 'Não distorcer o logo'],
  mayVary: ['Cor de destaque'],
  mustKeep: ['Logo em lugar fixo'],
  logo: { files: [{ url: 'https://x/logo.png' }], rules: 'Logo sempre sobre fundo claro.' },
  visualManual: { imageUrl: 'https://x/manual.png' },
};

describe('mergeDraftIntoForm', () => {
  it('preenche o que está vazio e diz quais seções', () => {
    const r = mergeDraftIntoForm(emptyForm(), draft);
    expect(r.form.essence).toBe('Imponente e sofisticada.');
    expect(r.form.palette).toEqual([{ hex: '#582731', name: 'Vinho', role: '' }, { hex: '#233766', name: '', role: '' }]);
    expect(r.form.neverDo).toBe('Evitar poluição visual\nNão distorcer o logo');
    expect(r.form.mayVary).toBe('Cor de destaque');
    expect(r.form.mustKeep).toBe('Logo em lugar fixo');
    expect(r.applied).toEqual(expect.arrayContaining(['essence', 'palette', 'neverDo', 'variation', 'logo']));
    expect(r.conflicts).toEqual([]);
  });

  it('nunca traz arquivo de logo nem imagem do manual: só as regras de uso', () => {
    const r = mergeDraftIntoForm(emptyForm(), draft);
    expect(r.form.logoFiles).toEqual([]);
    expect(r.form.manualImageUrl).toBe('');
    expect(r.form.logoRules).toBe('Logo sempre sobre fundo claro.');
  });

  it('não sobrescreve o que a pessoa já escreveu: vira conflito', () => {
    const base = { ...emptyForm(), essence: 'Texto da pessoa.', palette: [{ hex: '#000000', name: '', role: '' }] };
    const r = mergeDraftIntoForm(base, draft);
    expect(r.form.essence).toBe('Texto da pessoa.');
    expect(r.form.palette).toEqual(base.palette);
    expect(r.conflicts.map((c) => c.section).sort()).toEqual(['essence', 'palette']);
    expect(r.applied).not.toContain('essence');
  });

  it('o mesmo valor que já estava lá não é conflito nem preenchimento', () => {
    const base = { ...emptyForm(), essence: 'Imponente e sofisticada.' };
    const r = mergeDraftIntoForm(base, { essence: 'Imponente e sofisticada.' });
    expect(r.conflicts).toEqual([]);
    expect(r.applied).toEqual([]);
  });

  it('seção que o manual não trouxe fica como está', () => {
    const base = { ...emptyForm(), artDirection: 'Minha direção.' };
    const r = mergeDraftIntoForm(base, { essence: 'X' });
    expect(r.form.artDirection).toBe('Minha direção.');
    expect(r.conflicts).toEqual([]);
  });

  it('variação: se só um dos lados está preenchido, a seção não é "vazia" e o outro lado vira conflito', () => {
    const base = { ...emptyForm(), mayVary: 'Minha variação' };
    const r = mergeDraftIntoForm(base, draft);
    expect(r.form.mustKeep).toBe('');
    expect(r.conflicts.map((c) => c.section)).toContain('variation');
  });

  it('aceitar o conflito troca só os campos daquela seção', () => {
    const base = { ...emptyForm(), essence: 'Texto da pessoa.', artDirection: 'Mantida.' };
    const r = mergeDraftIntoForm(base, draft);
    const c = r.conflicts.find((x) => x.section === 'essence')!;
    const after = applyConflict(r.form, c);
    expect(after.essence).toBe('Imponente e sofisticada.');
    expect(after.artDirection).toBe('Mantida.');
  });

  it('não muta o formulário recebido', () => {
    const base = emptyForm();
    mergeDraftIntoForm(base, draft);
    expect(base).toEqual(emptyForm());
  });
});

describe('importSummary', () => {
  const ok = (over: Partial<ProfileImportResult> = {}): ProfileImportResult => ({ draft: {}, evidence: {}, notFound: [], warnings: [], status: 'ok', quotesChecked: false, ...over });

  it('conta campos e diferenças', () => {
    expect(importSummary(ok(), { form: emptyForm(), applied: ['a', 'b'], conflicts: [{ section: 'x', title: 'X', patch: {} }] })).toBe('2 campos preenchidos; 1 diferença com o que já estava na ficha.');
  });
  it('singular e nenhum', () => {
    expect(importSummary(ok(), { form: emptyForm(), applied: ['a'], conflicts: [] })).toBe('1 campo preenchido.');
    expect(importSummary(ok(), { form: emptyForm(), applied: [], conflicts: [] })).toBe('Nenhum campo vazio foi preenchido.');
  });
  it('falha mostra o motivo', () => {
    expect(importSummary(ok({ status: 'failed', reason: 'sem cota' }), { form: emptyForm(), applied: [], conflicts: [] })).toBe('sem cota');
  });
});
