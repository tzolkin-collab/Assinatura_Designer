import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/competitorDiscovery', () => ({
  discoverCompetitors: vi.fn(),
}));

// We use the full path to make sure mock works properly.
vi.mock('../lib/prisma.js', () => ({
  default: {
    brandConfig: {
      update: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    reference: {
      update: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 2));
        return {};
      }),
      updateMany: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 2));
        return { count: 100 };
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    brand: {
      findUnique: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Brand 1' }),
    }
  }
}));

vi.mock('../lib/apifyInstagram.js', () => ({
  fetchInstagramProfileReviews: vi.fn().mockResolvedValue(new Map())
}));

vi.mock('../lib/apifyWebsiteCrawler.js', () => ({
  fetchWebsiteReview: vi.fn().mockResolvedValue([])
}));

vi.mock('../lib/geminiRetry.js', () => ({
  generateWithRetry: vi.fn().mockResolvedValue({ text: 'summary' })
}));


import { runAutoResearchCycle } from '../lib/benchmarkOrchestrator';
import prisma from '../lib/prisma.js';
import { discoverCompetitors } from '../lib/competitorDiscovery';

describe('Performance benchmark for auto research cycle update loop', () => {
  it('should run fast', async () => {
    // Generate lots of refs that need to be updated
    const previousCandidates = Array.from({ length: 50 }).map((_, i) => ({
      id: `cand-${i}`,
      name: `Old Competitor ${i}`,
      confirmed: true,
      createdReferenceIds: [`ref-${i}-a`, `ref-${i}-b`, `ref-${i}-c`, `ref-${i}-d`, `ref-${i}-e`],
      status: 'ANALYZED'
    }));

    vi.mocked(prisma.brandConfig.findUnique).mockResolvedValue({
      brandId: 'brand-1',
      benchmarkSession: {
        status: 'DONE',
        recommended: [],
        candidates: previousCandidates as any,
        round: 1,
        updatedAt: new Date().toISOString(),
      } as any,
      guidelines: '',
    } as any);

    vi.mocked(discoverCompetitors).mockResolvedValue({
      competitors: [],
    } as any);

    const start = performance.now();
    await runAutoResearchCycle('brand-1', 'slug');
    const end = performance.now();

    const updateCalls = vi.mocked(prisma.reference.update).mock.calls.length;
    const updateManyCalls = vi.mocked(prisma.reference.updateMany).mock.calls.length;

    console.log(`Execution time: ${(end - start).toFixed(2)}ms`);
    console.log(`update calls: ${updateCalls}`);
    console.log(`updateMany calls: ${updateManyCalls}`);
  });
});
