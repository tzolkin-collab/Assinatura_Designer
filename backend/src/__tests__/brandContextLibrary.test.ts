import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  brand: null as Record<string, unknown> | null,
  parentAssets: [] as Array<{ url: string; name: string; tags: string[] }>,
  parentQuery: null as unknown,
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    brand: { findUnique: vi.fn(async () => h.brand) },
    asset: {
      findMany: vi.fn(async (q: unknown) => {
        h.parentQuery = q;
        return h.parentAssets;
      }),
    },
  },
}));

import { resolveBrandContext } from '../lib/brandContext.js';

const own = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://x/own-${i}.png`, name: `own-${i}`, tags: [] as string[] }));

beforeEach(() => {
  h.parentAssets = [];
  h.parentQuery = null;
});

describe('resolveBrandContext: biblioteca de um desdobramento', () => {
  it('marca comum: só a biblioteca dela, e a base não é consultada', async () => {
    h.brand = { id: 'b1', name: 'Base', slug: 'base', parentBrandId: null, config: null, assets: own(2) };
    const ctx = await resolveBrandContext('base');
    expect(ctx.libraryBrandIds).toEqual(['b1']);
    expect(ctx.assetUrls).toHaveLength(2);
    expect(h.parentQuery).toBeNull();
  });

  it('desdobramento herda os arquivos da base: os dele primeiro, sem repetir, no teto de 20', async () => {
    h.brand = { id: 'c1', name: 'Collab', slug: 'base-collab', parentBrandId: 'b1', config: null, assets: own(2) };
    h.parentAssets = [
      { url: 'https://x/own-0.png', name: 'repetido', tags: [] },
      { url: 'https://x/logo-base.png', name: 'logo-base', tags: ['LOGOTYPE'] },
    ];
    const ctx = await resolveBrandContext('base-collab');
    expect(ctx.libraryBrandIds).toEqual(['c1', 'b1']);
    expect(ctx.assetUrls.map((a) => a.url)).toEqual(['https://x/own-0.png', 'https://x/own-1.png', 'https://x/logo-base.png']);
    expect((h.parentQuery as { where: { brandId: string } }).where.brandId).toBe('b1');
  });

  it('teto de 20 arquivos no total, com os da própria marca na frente', async () => {
    h.brand = { id: 'c1', name: 'Collab', slug: 'c', parentBrandId: 'b1', config: null, assets: own(18) };
    h.parentAssets = Array.from({ length: 5 }, (_, i) => ({ url: `https://x/base-${i}.png`, name: `base-${i}`, tags: [] as string[] }));
    const ctx = await resolveBrandContext('c');
    expect(ctx.assetUrls).toHaveLength(20);
    expect(ctx.assetUrls[17]!.url).toBe('https://x/own-17.png');
    expect(ctx.assetUrls[18]!.url).toBe('https://x/base-0.png');
  });
});
