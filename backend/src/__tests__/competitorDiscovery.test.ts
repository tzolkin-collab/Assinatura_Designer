import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/geminiRetry', () => ({
  generateWithRetry: vi.fn(),
  humanizeGeminiError: vi.fn((err) => err),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
}));

import { discoverCompetitors } from '../lib/competitorDiscovery';
import { generateWithRetry } from '../lib/geminiRetry';

const mockCompetitorsResponse = (competitors: unknown[], question?: unknown) => JSON.stringify({ competitors, question });

describe('discoverCompetitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nunca combina tools com responseSchema/responseMimeType (mesma regra de referenceSync.ts)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: mockCompetitorsResponse([]) });

    await discoverCompetitors('Marca X', 'Nicho de tecnologia');

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].config.tools).toEqual([{ googleSearch: {} }]);
    expect(call[1].config.responseMimeType).toBeUndefined();
    expect(call[1].config.responseSchema).toBeUndefined();
  });

  it('teto de maxTotal aplicado mesmo se o modelo devolver mais que o pedido', async () => {
    const oito = Array.from({ length: 8 }, (_, i) => ({ name: `Concorrente ${i}`, websiteUrl: `https://c${i}.com` }));
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: mockCompetitorsResponse(oito) });

    const result = await discoverCompetitors('Marca X', 'Nicho', { maxTotal: 5 });

    expect(result.competitors).toHaveLength(5);
  });

  it('recommendedNames aparece no prompt mandado ao Gemini', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: mockCompetitorsResponse([]) });

    await discoverCompetitors('Marca X', 'Nicho', { recommendedNames: ['Rival A', 'Rival B'] });

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const promptText = call[1].contents.parts[0].text as string;
    expect(promptText).toContain('Rival A, Rival B');
  });

  it('extraContext aparece no prompt quando passado (resposta de uma rodada anterior)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({ text: mockCompetitorsResponse([]) });

    await discoverCompetitors('Marca X', 'Nicho', { extraContext: 'É uma marca de suplementos, não de roupas.' });

    const call = (generateWithRetry as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const promptText = call[1].contents.parts[0].text as string;
    expect(promptText).toContain('É uma marca de suplementos, não de roupas.');
  });

  it('question do modelo é repassada no retorno mesmo com competitors parcial', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: mockCompetitorsResponse(
        [{ name: 'Rival A', websiteUrl: 'https://rivala.com' }],
        { text: 'Existem duas marcas chamadas "Nike" em nichos diferentes, qual delas?', options: ['Moda esportiva', 'Boutique local'] },
      ),
    });

    const result = await discoverCompetitors('Marca X', 'Nicho');

    expect(result.competitors).toHaveLength(1);
    expect(result.question).toEqual({
      text: 'Existem duas marcas chamadas "Nike" em nichos diferentes, qual delas?',
      options: ['Moda esportiva', 'Boutique local'],
    });
  });

  it('allowQuestion: false — question do modelo é ignorada mesmo se vier preenchida (ciclo automático nunca pausa)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: mockCompetitorsResponse([{ name: 'Rival A', websiteUrl: 'https://rivala.com' }], { text: 'Pergunta qualquer' }),
    });

    const result = await discoverCompetitors('Marca X', 'Nicho', { allowQuestion: false });

    expect(result.question).toBeUndefined();
  });

  it('filtra candidatos sem nome ou sem nenhuma URL (não vira Reference de jeito nenhum)', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: mockCompetitorsResponse([
        { name: 'Sem URL nenhuma' },
        { websiteUrl: 'https://sem-nome.com' },
        { name: 'Válido', websiteUrl: 'https://valido.com' },
      ]),
    });

    const result = await discoverCompetitors('Marca X', 'Nicho');

    expect(result.competitors).toEqual([{ name: 'Válido', websiteUrl: 'https://valido.com' }]);
  });

  it('Gemini indisponível: nunca lança, devolve competitors vazio', async () => {
    (generateWithRetry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Gemini fora do ar'));

    await expect(discoverCompetitors('Marca X', 'Nicho')).resolves.toEqual({ competitors: [] });
  });
});
