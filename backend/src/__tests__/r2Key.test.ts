import { describe, it, expect, vi, beforeEach } from 'vitest';

// A derivação da key depende da URL pública configurada.
vi.mock('../config.js', () => ({
  config: {
    r2PublicUrl: 'https://cdn.exemplo.com',
    r2BucketName: 'bucket',
    r2Endpoint: 'https://r2.exemplo.com',
    r2AccessKeyId: 'k',
    r2SecretAccessKey: 's',
  },
}));

import { r2KeyFromUrl } from '../lib/r2';

describe('r2KeyFromUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extrai a key de uma URL do nosso bucket', () => {
    expect(r2KeyFromUrl('https://cdn.exemplo.com/brands/b1/uuid-logo.png')).toBe(
      'brands/b1/uuid-logo.png',
    );
  });

  it('decodifica caracteres escapados no nome', () => {
    expect(r2KeyFromUrl('https://cdn.exemplo.com/brands/b1/uuid-logo%20final.png')).toBe(
      'brands/b1/uuid-logo final.png',
    );
  });

  it('ignora query string', () => {
    expect(r2KeyFromUrl('https://cdn.exemplo.com/brands/b1/x.png?v=2')).toBe('brands/b1/x.png');
  });

  it('RECUSA URL de outro host — não apagamos o que não é nosso', () => {
    expect(r2KeyFromUrl('https://cdn.malicioso.com/brands/b1/x.png')).toBeNull();
    expect(r2KeyFromUrl('https://images.unsplash.com/foto.jpg')).toBeNull();
  });

  it('recusa a raiz do bucket (sem key não há o que apagar)', () => {
    expect(r2KeyFromUrl('https://cdn.exemplo.com/')).toBeNull();
  });
});
