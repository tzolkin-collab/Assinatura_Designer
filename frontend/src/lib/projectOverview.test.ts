import { describe, it, expect } from 'vitest';
import {
  asList,
  collabKindLabel,
  collabStatus,
  collabsOf,
  identityChecklist,
  libraryTotals,
  projectStatus,
  timeAgo,
  type ProfileCompleteness,
  type ProjectBrand,
} from './projectOverview';

const pronta: ProfileCompleteness = { percent: 100, ready: true, pending: [] };

describe('projectStatus', () => {
  it('ficha pronta: "Projeto-base pronto" com o percentual', () => {
    expect(projectStatus(pronta)).toEqual({ label: 'Projeto-base pronto', tone: 'ready', detail: '100% configurado' });
  });

  it('desdobramento pronto usa o substantivo certo', () => {
    expect(projectStatus(pronta, 'PARTNERSHIP').label).toBe('Desdobramento pronto');
  });

  it('com obrigatória pendente: em configuração, conta só as obrigatórias', () => {
    const c: ProfileCompleteness = {
      percent: 64,
      ready: false,
      pending: [
        { key: 'essence', label: 'Essência e posicionamento', required: true },
        { key: 'visualManual', label: 'Manual visual', required: true },
        { key: 'logo', label: 'Logo e assinatura', required: false },
      ],
    };
    expect(projectStatus(c)).toEqual({ label: 'Em configuração', tone: 'pending', detail: '64% configurado · 2 obrigatórias pendentes' });
  });

  it('singular quando falta uma só', () => {
    const c: ProfileCompleteness = { percent: 90, ready: false, pending: [{ key: 'essence', label: 'x', required: true }] };
    expect(projectStatus(c).detail).toBe('90% configurado · 1 obrigatória pendente');
  });
});

describe('collabStatus', () => {
  const emConfig: ProfileCompleteness = { percent: 64, ready: false, pending: [{ key: 'essence', label: 'x', required: true }] };

  it('pronto quando a base está pronta, e diz de quem herda', () => {
    expect(collabStatus('Amanda Coelho', pronta)).toEqual({ label: 'Desdobramento pronto', tone: 'ready', detail: 'herda de Amanda Coelho · ficha 100%' });
  });

  it('não promete pronto enquanto a base não está', () => {
    expect(collabStatus('Amanda Coelho', emConfig)).toEqual({ label: 'Aguardando o projeto-base', tone: 'pending', detail: 'a ficha de Amanda Coelho está em 64%' });
  });

  it('base ilegível: pendente, sem inventar percentual', () => {
    expect(collabStatus(undefined, null).tone).toBe('pending');
    expect(collabStatus('Amanda', undefined).detail).toBe('não consegui ler o projeto-base');
  });
});

describe('identityChecklist', () => {
  it('ficha vazia: nada marcado', () => {
    expect(identityChecklist({}).every((i) => !i.ok)).toBe(true);
  });

  it('marca só o que existe', () => {
    const r = identityChecklist({ palette: [{}], typography: [], logo: { files: [{}] }, visualManual: { imageUrl: 'https://x/a.png' } });
    expect(r).toEqual([
      { label: 'Manual', ok: true },
      { label: 'Cores', ok: true },
      { label: 'Fontes', ok: false },
      { label: 'Logos', ok: true },
    ]);
  });
});

describe('libraryTotals', () => {
  it('separa imagem fornecida, imagem gerada por IA e outros arquivos', () => {
    const t = libraryTotals([
      { fileType: 'image/png', source: 'upload' },
      { fileType: 'image/jpeg', source: 'drive' },
      { fileType: 'image/png', source: 'ai-generated' },
      { fileType: 'application/pdf', source: 'upload' },
      { fileType: 'image/svg+xml' },
    ]);
    expect(t).toEqual({ images: 3, generated: 1, otherFiles: 1 });
  });

  it('biblioteca vazia', () => {
    expect(libraryTotals([])).toEqual({ images: 0, generated: 0, otherFiles: 0 });
  });
});

describe('collabsOf', () => {
  const brands: ProjectBrand[] = [
    { id: 'a', slug: 'amanda', name: 'Amanda', kind: 'BASE' },
    { id: 'c1', slug: 'amanda-mentoria', name: 'Mentoria', kind: 'INTERNAL', parentBrandId: 'a', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'c2', slug: 'amanda-estadao', name: 'Estadão', kind: 'PARTNERSHIP', parentBrandId: 'a', updatedAt: '2026-10-09T00:00:00Z' },
    { id: 'x', slug: 'rubrica', name: 'Rúbrica', kind: 'BASE' },
    { id: 'c3', slug: 'rubrica-x', name: 'X', kind: 'INTERNAL', parentBrandId: 'x' },
  ];

  it('devolve só os filhos da base, o mais recente primeiro', () => {
    expect(collabsOf(brands, 'a').map((b) => b.slug)).toEqual(['amanda-estadao', 'amanda-mentoria']);
  });

  it('base sem desdobramentos', () => {
    expect(collabsOf(brands, 'inexistente')).toEqual([]);
  });
});

describe('asList', () => {
  it('aceita lista pura e lista dentro de { data }', () => {
    expect(asList<number>([1, 2])).toEqual([1, 2]);
    expect(asList<number>({ data: [3] })).toEqual([3]);
  });

  it('qualquer outra coisa vira lista vazia', () => {
    expect(asList(null)).toEqual([]);
    expect(asList(undefined)).toEqual([]);
    expect(asList({ data: 'x' })).toEqual([]);
    expect(asList('texto')).toEqual([]);
  });
});

describe('collabKindLabel', () => {
  it('nomeia cada tipo', () => {
    expect(collabKindLabel('PARTNERSHIP')).toBe('Parceria');
    expect(collabKindLabel('INTERNAL')).toBe('Desdobramento interno');
    expect(collabKindLabel(undefined)).toBe('Projeto-base');
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  it('formatos do mockup', () => {
    expect(timeAgo('2026-10-11T11:59:30Z', now)).toBe('agora');
    expect(timeAgo('2026-10-11T11:30:00Z', now)).toBe('há 30 min');
    expect(timeAgo('2026-10-11T07:00:00Z', now)).toBe('há 5 h');
    expect(timeAgo('2026-10-10T12:00:00Z', now)).toBe('há 1 dia');
    expect(timeAgo('2026-10-06T12:00:00Z', now)).toBe('há 5 dias');
    expect(timeAgo('2026-09-20T12:00:00Z', now)).toBe('há 3 semanas');
    expect(timeAgo('2026-07-01T12:00:00Z', now)).toBe('há 3 meses');
  });

  it('data ausente ou no futuro não quebra', () => {
    expect(timeAgo(undefined, now)).toBe('');
    expect(timeAgo('2026-12-01T00:00:00Z', now)).toBe('agora');
    expect(timeAgo('lixo', now)).toBe('agora');
  });
});
