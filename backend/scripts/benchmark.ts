import { performance } from 'perf_hooks';
import { runAutoResearchCycle, BenchmarkSession } from '../src/lib/benchmarkOrchestrator';
import { prisma } from '../src/lib/prisma';
import { discoverCompetitors } from '../src/lib/competitorDiscovery';
import { collectAllCandidates } from '../src/lib/assetCapture';

// Mock dependencies
jest.mock('../src/lib/competitorDiscovery', () => ({
  discoverCompetitors: jest.fn(),
}));

jest.mock('../src/lib/assetCapture', () => ({
  collectAllCandidates: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => {
  return {
    prisma: {
      brandConfig: {
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      reference: {
        update: jest.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 2)); // 2ms simulate DB latency
          return {};
        }),
        updateMany: jest.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 2));
          return { count: 100 };
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      brand: {
        findUnique: jest.fn().mockResolvedValue({ id: 'brand-1', name: 'Brand 1' }),
      }
    }
  }
});

async function run() {
  const previousCandidates = Array.from({ length: 50 }).map((_, i) => ({
    id: `cand-${i}`,
    name: `Old Competitor ${i}`,
    confirmed: true,
    createdReferenceIds: [`ref-${i}-a`, `ref-${i}-b`],
    status: 'ANALYZED'
  }));

  const session: BenchmarkSession = {
    status: 'DONE',
    recommended: [],
    candidates: previousCandidates as any,
    round: 1,
    updatedAt: new Date().toISOString(),
  };

  (prisma.brandConfig.findUnique as jest.Mock).mockResolvedValue({
    brandId: 'brand-1',
    benchmarkSession: session as any,
    guidelines: '',
  });

  // No current competitors found
  (discoverCompetitors as jest.Mock).mockResolvedValue({
    competitors: [],
  });

  (collectAllCandidates as jest.Mock).mockResolvedValue([]);

  const start = performance.now();
  await runAutoResearchCycle('brand-1', 'slug');
  const end = performance.now();

  console.log(`Execution time: ${(end - start).toFixed(2)}ms`);

  const updateCalls = (prisma.reference.update as jest.Mock).mock.calls.length;
  const updateManyCalls = (prisma.reference.updateMany as jest.Mock).mock.calls.length;
  console.log(`update calls: ${updateCalls}`);
  console.log(`updateMany calls: ${updateManyCalls}`);
}

run().catch(console.error);
