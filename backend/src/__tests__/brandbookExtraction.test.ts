// Testes da função PURA de extração de brandbook (backend/src/lib/brandbookExtraction.ts).
//
// Nada aqui fala com Prisma, R2 ou o Gemini de verdade: o cliente é injetado como um
// objeto fake (é exatamente para isto que a interface `GeminiExtractionClient` existe —
// ver a doc do módulo). Os testes de persistência (o que processBrandbookIngest faz
// com o resultado) ficam em brandbookIngestion.test.ts.

import { describe, it, expect, vi } from 'vitest';
import type { GenerateContentParameters, Part } from '@google/genai';
import {
  extractBrandInsights,
  mergeHexColorLists,
  colorDistance,
  normalizeHex,
  PDF_INLINE_MAX_BYTES,
  MAX_BRAND_COLORS,
  type GeminiExtractionClient,
} from '../lib/brandbookExtraction';

function fakeClient(overrides?: Partial<GeminiExtractionClient>): GeminiExtractionClient {
  return {
    models: {
      generateContent: vi.fn(async () => ({ text: JSON.stringify({ guidelines: '', colors: [], primaryFonts: [], svgs: [] }) })),
    },
    files: {
      upload: vi.fn(async () => ({ uri: 'https://generativelanguage.googleapis.com/v1/files/fake', mimeType: 'application/pdf', name: 'files/fake' })),
      delete: vi.fn(async () => ({})),
    },
    ...overrides,
  };
}

/** Extrai o texto do prompt (última `part` de texto) de uma chamada de generateContent. */
function promptTextFrom(call: GenerateContentParameters): string {
  const contents = call.contents as Part[];
  const textParts = contents.filter((p): p is { text: string } => typeof (p as Part).text === 'string');
  return textParts.map((p) => p.text).join('\n');
}

describe('extractBrandInsights — prompt genérico (não hardcoded para a Assinatura)', () => {
  it('não menciona Assinatura, estrela nem bisnaga quando a marca é outra', async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ guidelines: '', colors: [], primaryFonts: [], svgs: [] }) }));
    const client = fakeClient({ models: { generateContent } });

    await extractBrandInsights({
      client,
      brandName: 'Loja Verde Orgânicos',
      parts: [{ kind: 'image', mimeType: 'image/png', data: 'ZmFrZQ==' }],
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const prompt = promptTextFrom(generateContent.mock.calls[0]![0] as GenerateContentParameters).toLowerCase();
    expect(prompt).not.toContain('assinatura');
    expect(prompt).not.toContain('estrela');
    expect(prompt).not.toContain('bisnaga');
    // A regra anti-invenção precisa estar presente — é o que substitui a lista fixa de ícones.
    expect(prompt).toContain('proibido');
    expect(prompt).toContain('loja verde orgânicos');
  });

  it('sem partes e sem texto: não chama a IA e devolve status ok vazio (nada para analisar)', async () => {
    const generateContent = vi.fn();
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [] });

    expect(generateContent).not.toHaveBeenCalled();
    expect(result).toEqual({ guidelines: '', colors: [], primaryFonts: [], svgs: [], warnings: [], status: 'ok' });
  });

  it('só texto compartilhado (sem imagem/pdf) ainda aciona UMA chamada com o texto', async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ guidelines: 'Tom acolhedor', colors: [], primaryFonts: [], svgs: [] }) }));
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [], sharedText: '<style>.a{color:#112233}</style>' });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.guidelines).toBe('Tom acolhedor');
    const prompt = promptTextFrom(generateContent.mock.calls[0]![0] as GenerateContentParameters);
    expect(prompt).toContain('#112233');
  });
});

describe('extractBrandInsights — PDFs grandes usam a Files API', () => {
  it('PDF acima do limite inline vai por ai.files.upload e o arquivo remoto é apagado no fim', async () => {
    const bigBuffer = Buffer.alloc(PDF_INLINE_MAX_BYTES + 1024, 7);
    const upload = vi.fn(async () => ({ uri: 'https://generativelanguage.googleapis.com/v1/files/grande', mimeType: 'application/pdf', name: 'files/grande' }));
    const del = vi.fn(async () => ({}));
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ guidelines: '', colors: [{ hex: '#582731' }], primaryFonts: [], svgs: [] }) }));
    const client = fakeClient({ models: { generateContent }, files: { upload, delete: del } });

    const result = await extractBrandInsights({
      client,
      brandName: 'Marca X',
      parts: [{ kind: 'pdf', buffer: bigBuffer, fileName: 'plataforma-de-marca.pdf' }],
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toMatchObject({ config: { mimeType: 'application/pdf', displayName: 'plataforma-de-marca.pdf' } });
    expect(del).toHaveBeenCalledWith({ name: 'files/grande' });

    const sentContents = generateContent.mock.calls[0]![0]!.contents as Part[];
    expect(sentContents.some((p) => p.fileData?.fileUri === 'https://generativelanguage.googleapis.com/v1/files/grande')).toBe(true);
    // Não deve existir NENHUM inlineData de PDF gigante na mesma chamada.
    expect(sentContents.some((p) => p.inlineData?.mimeType === 'application/pdf')).toBe(false);
    expect(result.status).toBe('ok');
    expect(result.colors).toEqual([{ hex: '#582731' }]);
  });

  it('PDF pequeno vai inline, sem tocar a Files API', async () => {
    const smallBuffer = Buffer.from('%PDF-1.4 conteúdo pequeno', 'utf-8');
    const upload = vi.fn();
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ guidelines: '', colors: [], primaryFonts: [], svgs: [] }) }));
    const client = fakeClient({ models: { generateContent }, files: { upload, delete: vi.fn() } });

    await extractBrandInsights({ client, brandName: 'Marca X', parts: [{ kind: 'pdf', buffer: smallBuffer, fileName: 'pequeno.pdf' }] });

    expect(upload).not.toHaveBeenCalled();
    const sentContents = generateContent.mock.calls[0]![0]!.contents as Part[];
    expect(sentContents.some((p) => p.inlineData?.mimeType === 'application/pdf')).toBe(true);
  });
});

describe('extractBrandInsights — map-reduce: um arquivo por chamada, resultados unidos', () => {
  it('dois PDFs geram DUAS chamadas e o resultado combina cores, fontes e guidelines dos dois', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ guidelines: 'Identidade visual: minimalista.', colors: [{ hex: '#582731' }], primaryFonts: [{ family: 'Aileron', role: 'texto corrido' }], svgs: [] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ guidelines: 'Posicionamento: premium.', colors: [{ hex: '#233766' }], primaryFonts: [{ family: 'Monument Extended', role: 'logo' }], svgs: [] }) });
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({
      client,
      brandName: 'Marca X',
      parts: [
        { kind: 'pdf', buffer: Buffer.from('%PDF id-rebranding'), fileName: 'id-rebranding.pdf' },
        { kind: 'pdf', buffer: Buffer.from('%PDF plataforma-marca'), fileName: 'plataforma-marca.pdf' },
      ],
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ok');
    expect(result.colors).toEqual(expect.arrayContaining([{ hex: '#582731' }, { hex: '#233766' }]));
    expect(result.primaryFonts).toEqual(expect.arrayContaining([
      { family: 'Aileron', role: 'texto corrido' },
      { family: 'Monument Extended', role: 'logo' },
    ]));
    expect(result.guidelines).toContain('minimalista');
    expect(result.guidelines).toContain('premium');
  });

  it('imagens soltas vão TODAS numa única chamada (não uma por imagem)', async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ guidelines: '', colors: [], primaryFonts: [], svgs: [] }) }));
    const client = fakeClient({ models: { generateContent } });

    await extractBrandInsights({
      client,
      brandName: 'Marca X',
      parts: [
        { kind: 'image', mimeType: 'image/png', data: 'AAA=' },
        { kind: 'image', mimeType: 'image/png', data: 'BBB=' },
        { kind: 'image', mimeType: 'image/jpeg', data: 'CCC=' },
      ],
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const sentContents = generateContent.mock.calls[0]![0]!.contents as Part[];
    const inlineImages = sentContents.filter((p) => p.inlineData?.mimeType?.startsWith('image/'));
    expect(inlineImages).toHaveLength(3);
  });
});

describe('extractBrandInsights — falha honesta (sem inventar sucesso)', () => {
  it('Gemini falhando em TODAS as chamadas devolve status failed com reason, sem cores/fontes', async () => {
    const generateContent = vi.fn(async () => { throw new Error('Your prepayment credits are depleted'); });
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [{ kind: 'image', mimeType: 'image/png', data: 'AAA=' }] });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('credits are depleted');
    expect(result.colors).toEqual([]);
    expect(result.primaryFonts).toEqual([]);
    expect(result.guidelines).toBe('');
  });

  it('uma falha entre duas partes vira status partial, preservando o que deu certo', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(new Error('503 overloaded'))
      .mockResolvedValueOnce({ text: JSON.stringify({ guidelines: 'Tom direto.', colors: [{ hex: '#111111' }], primaryFonts: [], svgs: [] }) });
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({
      client,
      brandName: 'Marca X',
      parts: [
        { kind: 'pdf', buffer: Buffer.from('%PDF um'), fileName: 'um.pdf' },
        { kind: 'pdf', buffer: Buffer.from('%PDF dois'), fileName: 'dois.pdf' },
      ],
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toContain('um.pdf');
    expect(result.colors).toEqual([{ hex: '#111111' }]);
    expect(result.warnings.some((w) => w.includes('um.pdf'))).toBe(true);
  });

  it('resposta vazia da IA conta como falha daquela parte, não como sucesso silencioso', async () => {
    const generateContent = vi.fn(async () => ({ text: '' }));
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [{ kind: 'image', mimeType: 'image/png', data: 'AAA=' }] });

    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/vazia/i);
  });
});

describe('extractBrandInsights — resgate de JSON truncado', () => {
  it('JSON cortado no fim é recuperado e o truncamento é avisado em warnings', async () => {
    // Termina logo depois do segundo objeto de cor — falta fechar o array e o objeto raiz.
    const truncado = '{"guidelines":"Boa marca dedicada.","colors":[{"hex":"#112233"},{"hex":"#445566"}';
    const generateContent = vi.fn(async () => ({ text: truncado }));
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [{ kind: 'image', mimeType: 'image/png', data: 'AAA=' }] });

    expect(result.status).toBe('ok');
    expect(result.guidelines).toBe('Boa marca dedicada.');
    expect(result.colors).toEqual([{ hex: '#112233' }, { hex: '#445566' }]);
    expect(result.warnings.some((w) => w.toLowerCase().includes('truncad'))).toBe(true);
  });
});

describe('extractBrandInsights — fontes com papel (role) quando o documento declara', () => {
  it('aceita string simples e objeto com role, preservando o que veio', async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({
        guidelines: '',
        colors: [],
        primaryFonts: [{ family: 'Aileron', role: 'texto corrido' }, 'Monument Extended'],
        svgs: [],
      }),
    }));
    const client = fakeClient({ models: { generateContent } });

    const result = await extractBrandInsights({ client, brandName: 'Marca X', parts: [{ kind: 'image', mimeType: 'image/png', data: 'AAA=' }] });

    expect(result.primaryFonts).toEqual(expect.arrayContaining([
      { family: 'Aileron', role: 'texto corrido' },
      { family: 'Monument Extended' },
    ]));
  });
});

// Mesmo teto usado internamente pelo módulo (COLOR_DEDUPE_DISTANCE) — repetido aqui
// como valor literal para o teste não depender de importar uma constante privada.
const COLOR_DEDUPE_THRESHOLD_TEST = 20;

describe('normalizeHex / colorDistance', () => {
  it('normaliza 3 e 6 dígitos para maiúsculo com #', () => {
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex('#112233')).toBe('#112233');
    expect(normalizeHex('não é cor')).toBeNull();
  });

  it('cores quase idênticas têm distância pequena; cores distintas, distância grande', () => {
    expect(colorDistance('#3E101F', '#3C111C')).toBeLessThan(COLOR_DEDUPE_THRESHOLD_TEST);
    expect(colorDistance('#582731', '#8A0E2E')).toBeGreaterThan(COLOR_DEDUPE_THRESHOLD_TEST);
  });
});

describe('mergeHexColorLists — deduplicação por distância e teto', () => {
  it('descarta quase-duplicata (mesma cor com erro de arredondamento)', () => {
    const { colors, droppedForCap } = mergeHexColorLists([['#3E101F'], ['#3C111C']]);
    expect(colors).toEqual(['#3E101F']);
    expect(droppedForCap).toEqual([]);
  });

  it('mantém cores claramente distintas da paleta oficial da Assinatura', () => {
    const oficiais = ['#582731', '#8A0E2E', '#D41D59', '#233766', '#545BAE', '#E9BDA6'];
    const { colors } = mergeHexColorLists([oficiais]);
    expect(colors).toEqual(oficiais.map((h) => h.toUpperCase()));
  });

  it('respeita a ordem de prioridade entre listas (a primeira lista vence em empate de proximidade)', () => {
    const { colors } = mergeHexColorLists([['#3E101F'], ['#3C111C'], ['#123456']]);
    expect(colors).toEqual(['#3E101F', '#123456']);
  });

  it('aplica o teto de 24 e reporta o que foi descartado', () => {
    const levels = [0, 51, 102, 153, 204, 255];
    const manyHex: string[] = [];
    for (const r of levels) {
      for (const g of levels) {
        if (manyHex.length >= 30) break;
        manyHex.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}00`);
      }
    }

    const { colors, droppedForCap } = mergeHexColorLists([manyHex]);
    expect(colors).toHaveLength(MAX_BRAND_COLORS);
    expect(droppedForCap).toHaveLength(30 - MAX_BRAND_COLORS);
  });
});
