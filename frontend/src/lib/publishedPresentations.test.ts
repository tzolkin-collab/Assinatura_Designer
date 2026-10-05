import { describe, it, expect } from 'vitest';
import {
  displayTitle,
  filterAndSort,
  formatPublishedDate,
  isEditedAfterPublish,
  shortPublicUrl,
  typesPresent,
  type PublishedPost,
} from './publishedPresentations';

const post = (over: Partial<PublishedPost> = {}): PublishedPost => ({
  id: 'p1',
  name: 'Proposta Alfa',
  type: 'PRESENTATION',
  publicSlug: 'abc123',
  publishedAt: '2026-08-24T18:00:00.000Z',
  updatedAt: '2026-08-24T18:00:30.000Z',
  slideCount: 7,
  cover: null,
  ...over,
});

describe('displayTitle', () => {
  it('usa o nome quando existe', () => {
    expect(displayTitle(post({ name: '  Proposta Alfa ' }))).toBe('Proposta Alfa');
  });
  it('sem nome, usa o primeiro título do slide', () => {
    expect(displayTitle(post({ name: null, cover: { html: '', width: 1920, height: 1080, title: 'A Arte da Curadoria' } }))).toBe('A Arte da Curadoria');
  });
  it('sem nome nem título, um texto honesto (e não "Sem nome")', () => {
    expect(displayTitle(post({ name: '   ', cover: null }))).toBe('Apresentação sem título');
  });
});

describe('isEditedAfterPublish', () => {
  it('a própria publicação mexe em updatedAt e não conta', () => {
    expect(isEditedAfterPublish(post())).toBe(false);
  });
  it('edição bem depois da publicação conta', () => {
    expect(isEditedAfterPublish(post({ updatedAt: '2026-08-25T10:00:00.000Z' }))).toBe(true);
  });
  it('data inválida não acusa edição', () => {
    expect(isEditedAfterPublish(post({ updatedAt: 'quebrado' }))).toBe(false);
  });
});

describe('formatPublishedDate', () => {
  it('formata em português, sem ponto do mês abreviado', () => {
    const s = formatPublishedDate('2026-08-24T12:00:00.000Z');
    expect(s).toMatch(/24/);
    expect(s).toMatch(/2026/);
    expect(s).not.toContain('.');
  });
  it('data inválida vira traço', () => {
    expect(formatPublishedDate('nada')).toBe('—');
  });
});

describe('shortPublicUrl', () => {
  it('tira o protocolo', () => {
    expect(shortPublicUrl('https://designer.exemplo.com', 'abc')).toBe('designer.exemplo.com/apresentacao/abc');
    expect(shortPublicUrl('http://localhost:3000', 'abc')).toBe('localhost:3000/apresentacao/abc');
  });
});

describe('filterAndSort', () => {
  const lista = [
    post({ id: 'a', name: 'Zebra', publishedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' }),
    post({ id: 'b', name: 'Árvore', type: 'CAROUSEL', publishedAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }),
    post({ id: 'c', name: 'Mapa', publicSlug: 'xyz999', publishedAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' }),
  ];
  const f = (over = {}) => filterAndSort(lista, { query: '', type: 'ALL', sort: 'recent', ...over }).map((p) => p.id);

  it('mais recentes primeiro (publicação)', () => expect(f()).toEqual(['b', 'c', 'a']));
  it('por nome, em ordem de português (Árvore antes de Mapa)', () => expect(f({ sort: 'name' })).toEqual(['b', 'c', 'a']));
  it('por última edição', () => expect(f({ sort: 'edited' })).toEqual(['a', 'b', 'c']));
  it('filtra por tipo', () => expect(f({ type: 'CAROUSEL' })).toEqual(['b']));
  it('busca sem diferenciar acento nem maiúscula', () => expect(f({ query: 'ARVORE' })).toEqual(['b']));
  it('busca também pelo endereço', () => expect(f({ query: 'xyz9' })).toEqual(['c']));
  it('busca sem resultado devolve lista vazia', () => expect(f({ query: 'inexistente' })).toEqual([]));
  it('não altera a lista original', () => {
    const antes = lista.map((p) => p.id);
    f({ sort: 'name' });
    expect(lista.map((p) => p.id)).toEqual(antes);
  });
});

describe('typesPresent', () => {
  it('só os tipos que existem, na ordem fixa', () => {
    expect(typesPresent([post({ type: 'CAROUSEL' }), post({ type: 'PRESENTATION' })])).toEqual(['PRESENTATION', 'CAROUSEL']);
    expect(typesPresent([])).toEqual([]);
  });
});
