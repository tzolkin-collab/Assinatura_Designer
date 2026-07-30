import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from './client';

vi.mock('../lib/competitorDiscovery', () => ({
  discoverCompetitors: vi.fn(async (name, guide, opts) => {
    return { competitors: opts.recommendedNames.map(n => ({ name: n, instagramUrl: `https://instagram.com/${n}` })) };
  }),
}));
vi.mock('../lib/referenceSync', () => ({
  analyzeReferenceFromCollectedMaterial: vi.fn(async () => {}),
}));
vi.mock('../lib/brandContext', () => ({
  getBrandContext: vi.fn(async () => ({ name: 'n', guidelines: 'g' })),
}));
vi.mock('../lib/apifyInstagram', () => ({
  fetchInstagramProfileReviews: vi.fn(async (urls: string[]) => {
    const map = new Map();
    for (const url of urls) map.set(url, { posts: [{ imageUrl: `${url}/post.jpg` }] });
    return map;
  }),
}));

import { runAutoResearchCycle } from '../lib/benchmarkOrchestrator';
import * as orchestratorModule from '../lib/benchmarkOrchestrator';

describe('N+1 Benchmark', () => {
  it('measures performance before and after', async () => {
    const numCandidates = 10;
    const previousCandidates = Array.from({ length: numCandidates }, (_, i) => ({
      id: `cand-${i}`,
      name: `Rival ${i}`,
      confirmed: true,
      createdReferenceIds: [`ref-${i}-a`, `ref-${i}-b`],
    }));

    vi.spyOn(orchestratorModule, 'getBenchmarkSession').mockResolvedValue({
      recommended: previousCandidates.map(c => c.name),
      candidates: previousCandidates,
    } as any);

    prismaMock.brandConfig.update.mockResolvedValue({} as any);
    prismaMock.reference.update.mockResolvedValue({} as any);

    let findUniqueCalls = 0;

    prismaMock.reference.findUnique.mockImplementation(async (args) => {
      findUniqueCalls++;
      // Return a truthy analysisUrl so it continues processing
      return { id: args.where.id, analysisUrl: 'http://example.com' } as any;
    });

    await runAutoResearchCycle('brand-1', 'slug');

    console.log(`findUniqueCalls: ${findUniqueCalls}`);
  });
});
