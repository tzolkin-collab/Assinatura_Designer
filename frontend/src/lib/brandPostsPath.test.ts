import { describe, expect, it } from 'vitest';
import { brandPostsPath } from './brandPostsPath';

describe('brandPostsPath', () => {
  it('lista completa por padrão (o Editor lê o content inteiro)', () => {
    expect(brandPostsPath('amanda-coelho')).toBe('/brands/amanda-coelho/posts');
  });

  it('a Galeria pede a lista leve', () => {
    expect(brandPostsPath('amanda-coelho', 'gallery')).toBe('/brands/amanda-coelho/posts?view=gallery');
  });
});
