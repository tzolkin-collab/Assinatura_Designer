import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import './client';
import { redis } from '../lib/redis';
import { config } from '../config';
import { assertWithinBudget, recordUsage } from '../lib/aiBudget';
import { runWithAiContext } from '../lib/aiContext';

const redisMock = redis as unknown as Record<string, Mock>;

/** O contador do dia responde `usados` para a marca e para o global. */
function comConsumo(usados: number) {
  redisMock.get.mockImplementation(async () => String(usados));
}

describe('Teto de gasto de IA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue(null);
  });

  it('deixa passar quando o consumo está abaixo do teto', async () => {
    comConsumo(10);
    await expect(assertWithinBudget()).resolves.toBeUndefined();
  });

  it('corta a chamada quando o teto global do dia estourou', async () => {
    comConsumo(config.aiDailyTokenBudget + 1);

    await expect(assertWithinBudget()).rejects.toMatchObject({ statusCode: 429 });
  });

  it('corta por marca mesmo com o global folgado', async () => {
    // Global abaixo do teto, marca acima do dela: quem estourou foi a marca.
    redisMock.get.mockImplementation(async (key: string) =>
      key.includes(':brand:') ? String(config.aiBrandDailyTokenBudget + 1) : '1',
    );

    await expect(
      runWithAiContext({ brandSlug: 'marca-gastona' }, () => assertWithinBudget()),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it('sem marca no contexto, o teto por marca não se aplica (só o global)', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key.includes(':brand:') ? String(config.aiBrandDailyTokenBudget + 1) : '1',
    );

    await expect(assertWithinBudget()).resolves.toBeUndefined();
  });

  it('soma os tokens da chamada no contador da marca e no global', async () => {
    const incrby = vi.fn((..._args: unknown[]) => chain);
    const chain = { incrby, expire: vi.fn(() => chain), exec: vi.fn(async () => []) };
    redisMock.multi.mockReturnValue(chain);

    await runWithAiContext({ brandSlug: 'marca-1' }, () =>
      recordUsage('gemini-3.1-pro-preview', { totalTokenCount: 1234 }),
    );

    const chaves = incrby.mock.calls.map((c) => String(c[0]));
    expect(chaves.some((k) => k.endsWith(':global'))).toBe(true);
    expect(chaves.some((k) => k.includes(':brand:marca-1'))).toBe(true);
    expect(incrby.mock.calls.every((c) => c[1] === 1234)).toBe(true);
  });

  it('falha do Redis não derruba a geração do usuário', async () => {
    redisMock.multi.mockImplementation(() => {
      throw new Error('Redis fora do ar');
    });

    // Perder a contagem é ruim; matar a geração por causa dela é pior.
    await expect(recordUsage('gemini-3.5-flash', { totalTokenCount: 10 })).resolves.toBeUndefined();
  });

  it('resposta sem usageMetadata não vira contagem fantasma', async () => {
    await recordUsage('gemini-3.5-flash', undefined);
    expect(redisMock.multi).not.toHaveBeenCalled();
  });
});
