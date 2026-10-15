import { describe, it, expect, vi } from 'vitest';
import {
  buildProfilePrompt,
  describesTheDocument,
  extractProfileFromManual,
  mergeProfileResults,
  parseProfileResponse,
  plainTextFromHtml,
  quoteInSource,
  sanitizeProfileExtraction,
} from '../lib/profileExtraction';
import type { GeminiExtractionClient } from '../lib/brandbookExtraction';

const MANUAL = `
Códigos que não podem sumir. Personalidade: Imponente, Antenada, Altruísta.
Fontes e cores. Aileron: textos, subtítulos e materiais institucionais. Monument: títulos curtos e chamadas fortes.
Paleta: #582731 #233766 #8A0E2E.
Evitar poluição, banco de imagem genérico e excesso de informação.
Se eu tirar o logo, ainda parece Assinatura?
`;

describe('quoteInSource e normalização', () => {
  it('acha o trecho ignorando acento, caixa e pontuação', () => {
    expect(quoteInSource('codigos que nao podem sumir', MANUAL)).toBe(true);
    expect(quoteInSource('SE EU TIRAR O LOGO ainda parece assinatura', MANUAL)).toBe(true);
  });

  it('não acha o que não está lá, nem trecho vazio', () => {
    expect(quoteInSource('A marca é focada em sustentabilidade', MANUAL)).toBe(false);
    expect(quoteInSource('   ', MANUAL)).toBe(false);
  });
});

describe('parseProfileResponse', () => {
  it('lê JSON puro, com cerca de código e com texto em volta', () => {
    expect(parseProfileResponse('{"a":1}')).toEqual({ a: 1 });
    expect(parseProfileResponse('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseProfileResponse('Aqui está: {"a":3} fim')).toEqual({ a: 3 });
  });

  it('lixo vira null, sem estourar', () => {
    expect(parseProfileResponse('isto não é json')).toBeNull();
    expect(parseProfileResponse('')).toBeNull();
  });
});

describe('sanitizeProfileExtraction: as travas', () => {
  const resposta = {
    palette: [
      { hex: '#582731', quote: 'Paleta: #582731 #233766', page: 7 },
      { hex: '#233766', role: 'azul institucional', quote: 'Paleta: #582731 #233766', page: 7 },
      { hex: '#582731', quote: 'repetida' },
      { hex: 'vinho', quote: 'Paleta: #582731' },
      { hex: '#ABCDEF' },
    ],
    typography: [
      { family: 'Aileron', role: 'textos, subtítulos', quote: 'Aileron: textos, subtítulos e materiais institucionais', page: 7 },
      { family: 'Monument', quote: 'Monument: títulos curtos' },
    ],
    neverDo: [{ text: 'Poluição visual', quote: 'Evitar poluição, banco de imagem genérico', page: 8 }],
    approvalCriterion: { text: 'Se eu tirar o logo, ainda parece Assinatura?', quote: 'Se eu tirar o logo, ainda parece Assinatura?', page: 12 },
    brandCodes: [{ category: 'Personalidade', items: ['Imponente', 'Antenada', 'Altruísta'], quote: 'Personalidade: Imponente, Antenada, Altruísta', page: 6 }],
    notFound: ['essence', 'logo'],
  };

  it('com o texto do material: tudo que tem trecho verdadeiro entra, com a evidência', () => {
    const r = sanitizeProfileExtraction(resposta, MANUAL);
    expect(r.quotesChecked).toBe(true);
    expect(r.draft.palette).toEqual([{ hex: '#582731' }, { hex: '#233766', role: 'azul institucional' }]);
    expect(r.draft.typography).toEqual([{ family: 'Aileron', role: 'textos, subtítulos' }, { family: 'Monument' }]);
    expect(r.draft.neverDo).toEqual(['Poluição visual']);
    expect(r.draft.approvalCriterion).toContain('logo');
    expect(r.draft.brandCodes).toEqual([{ category: 'Personalidade', items: ['Imponente', 'Antenada', 'Altruísta'] }]);
    expect(r.evidence.palette).toEqual([
      { label: '#582731', quote: 'Paleta: #582731 #233766', page: 7 },
      { label: '#233766', quote: 'Paleta: #582731 #233766', page: 7 },
    ]);
    // "Não encontrado" é calculado pelo que a ficha continua sem, não pelo que o modelo avisou.
    expect(r.notFound).toEqual(['essence', 'writingDirection', 'artDirection', 'realPhoto', 'graphicElements', 'variation', 'collabRules']);
  });

  it('item sem trecho é descartado, e cor com hex inválido também', () => {
    const r = sanitizeProfileExtraction(resposta);
    expect(r.draft.palette?.map((c) => c.hex)).toEqual(['#582731', '#233766']);
    expect(r.warnings.some((w) => w.includes('hex inválido (vinho)'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('#ABCDEF'))).toBe(true);
  });

  it('sem o texto do material não dá para conferir: marca quotesChecked falso', () => {
    expect(sanitizeProfileExtraction(resposta).quotesChecked).toBe(false);
  });

  it('trecho inventado é descartado quando dá para conferir', () => {
    const r = sanitizeProfileExtraction(
      {
        essence: { text: 'Marca de luxo sustentável e inovadora.', quote: 'Somos uma marca de luxo sustentável', page: 2 },
        artDirection: { text: 'Respiro e elegância.', quote: 'Evitar poluição, banco de imagem genérico' },
      },
      MANUAL,
    );
    expect(r.draft.essence).toBeUndefined();
    // O texto parafraseado dá lugar ao trecho literal do manual.
    expect(r.draft.artDirection).toBe('Evitar poluição, banco de imagem genérico');
    expect(r.warnings).toContain('Descartado porque o trecho não está no material: essence');
    expect(r.warnings).toContain('Texto trocado pelo trecho literal do manual (o modelo tinha parafraseado): artDirection');
  });

  it('nunca preenche logo, manual nem arquivos, mesmo que o modelo mande', () => {
    const r = sanitizeProfileExtraction({
      logo: { files: [{ url: 'https://x.com/l.png' }] },
      visualManual: { imageUrl: 'https://x.com/m.png' },
      typography: [{ family: 'Aileron', fileUrl: 'https://x.com/a.otf', quote: 'Aileron: textos' }],
    });
    expect(r.draft.logo).toBeUndefined();
    expect(r.draft.visualManual).toBeUndefined();
    expect(r.draft.typography).toEqual([{ family: 'Aileron' }]);
  });

  it('regras do logo entram como texto, sem arquivo', () => {
    const r = sanitizeProfileExtraction({ logoRules: { text: 'Nunca redesenhar o logo.', quote: 'Nunca redesenhar o logo' } });
    expect(r.draft.logo).toEqual({ rules: 'Nunca redesenhar o logo.' });
    expect(r.evidence.logo).toHaveLength(1);
  });

  it('resposta que não é objeto vira rascunho vazio, sem erro', () => {
    for (const lixo of [null, 'texto', 42, [1, 2]]) {
      const r = sanitizeProfileExtraction(lixo);
      expect(r.draft).toEqual({});
    }
  });

  it('a ficha final passa no esquema (hex em maiúsculas)', () => {
    const r = sanitizeProfileExtraction({ palette: [{ hex: '#8a0e2e', quote: 'x' }] });
    expect(r.draft.palette).toEqual([{ hex: '#8A0E2E' }]);
  });
});

describe('sanitizeProfileExtraction: classificação e literalidade', () => {
  it('texto fiel ao trecho fica como veio; paráfrase é trocada pelo trecho literal', () => {
    const fiel = sanitizeProfileExtraction({ writingDirection: { text: 'Sofisticado, Moderno, Acolhedor', quote: 'TOM: Sofisticado, Moderno, Acolhedor, Acessível, Seguro' } });
    const parafrase = sanitizeProfileExtraction({ writingDirection: { text: 'O tom da marca deve transmitir sofisticação', quote: 'TOM: Sofisticado, Moderno, Acolhedor, Acessível, Seguro' } });
    expect(fiel.draft.writingDirection).toBe('Sofisticado, Moderno, Acolhedor');
    expect(parafrase.draft.writingDirection).toBe('TOM: Sofisticado, Moderno, Acolhedor, Acessível, Seguro');
  });

  it('o mesmo trecho não sustenta dois campos: fica com o de maior prioridade', () => {
    const r = sanitizeProfileExtraction({
      realPhoto: { text: 'Priorizar imagens elegantes. Usar texturas cosméticas, pele e embalagem.', quote: 'Priorizar imagens elegantes. Usar texturas cosméticas, pele e embalagem.' },
      graphicElements: { text: 'Usar texturas cosméticas, pele e embalagem.', quote: 'Usar texturas cosméticas, pele e embalagem.' },
    });
    expect(r.draft.realPhoto).toBeDefined();
    expect(r.draft.graphicElements).toBeUndefined();
    expect(r.warnings).toContain('Descartado porque o mesmo trecho já sustenta outro campo: graphicElements');
  });

  it('trechos diferentes em campos diferentes convivem', () => {
    const r = sanitizeProfileExtraction({
      realPhoto: { text: 'Fotos reais em preto e branco.', quote: 'Fotos reais em preto e branco.' },
      graphicElements: { text: 'Linhas finas e monograma ampliado.', quote: 'Linhas finas e monograma ampliado.' },
    });
    expect(r.draft.realPhoto).toBeDefined();
    expect(r.draft.graphicElements).toBeDefined();
  });

  it('item de lista com ponto e vírgula vira vários itens, cada um com a mesma evidência', () => {
    const r = sanitizeProfileExtraction({
      mayVary: [{ text: 'Layout dos slides; Ordem narrativa; Imagens e mockups.', quote: 'PODE MUDAR: Layout dos slides; Ordem narrativa; Imagens e mockups', page: 9 }],
    });
    expect(r.draft.mayVary).toEqual(['Layout dos slides', 'Ordem narrativa', 'Imagens e mockups']);
    expect(r.evidence.variation).toHaveLength(3);
    expect(r.evidence.variation![0]).toMatchObject({ page: 9 });
  });

  it('regra de logo que é só um item de "precisa ficar" não é regra de logo', () => {
    const r = sanitizeProfileExtraction({
      mustKeep: [{ text: 'Logo e aplicação correta', quote: 'Logo e aplicação correta' }],
      logoRules: { text: 'Logo e aplicação correta', quote: 'Logo e aplicação correta' },
    });
    expect(r.draft.mustKeep).toEqual(['Logo e aplicação correta']);
    expect(r.draft.logo).toBeUndefined();
    expect(r.evidence.logo).toBeUndefined();
  });

  it('notFound nunca lista logo nem manual visual: vêm da biblioteca, não de um manual', () => {
    const r = sanitizeProfileExtraction({});
    expect(r.notFound).not.toContain('logo');
    expect(r.notFound).not.toContain('visualManual');
    expect(r.notFound).toHaveLength(12);
  });
});

describe('essência: definição do documento não é essência da marca', () => {
  it('reconhece trechos que explicam o que é o documento', () => {
    for (const q of [
      'PLATAFORMA DE MARCA (estratégia): Define o que a marca pensa, fala e defende.',
      'A plataforma de marca define o que a marca pensa, fala e defende.',
      'Define o que a marca pensa, fala e defende. Orienta posicionamento, tom e personalidade.',
      'O manual visual orienta cores, fontes e aplicação do logo.',
      'Orienta cores, fontes, imagens, ícones e grafismos.',
    ]) {
      expect(describesTheDocument(q)).toBe(true);
    }
  });

  it('não confunde com texto que diz quem é a marca', () => {
    for (const q of [
      'A Assinatura é imponente, sofisticada e ambiciosa.',
      'Somos a marca própria que transforma conhecimento em realização.',
      'Mulher forte, sofisticada, segura e contemporânea.',
    ]) {
      expect(describesTheDocument(q)).toBe(false);
    }
  });

  it('a essência vinda de uma definição é descartada, com aviso', () => {
    const r = sanitizeProfileExtraction({
      essence: { text: 'Define o que a marca pensa, fala e defende.', quote: 'PLATAFORMA DE MARCA (estratégia): Define o que a marca pensa, fala e defende.', page: 2 },
    });
    expect(r.draft.essence).toBeUndefined();
    expect(r.notFound).toContain('essence');
    expect(r.warnings).toContain('Descartado porque o trecho define o que é o documento, não diz quem é a marca: essence');
  });

  it('a essência de verdade passa', () => {
    const r = sanitizeProfileExtraction({ essence: { text: 'Imponente, sofisticada e ambiciosa.', quote: 'A Assinatura é imponente, sofisticada e ambiciosa.' } });
    expect(r.draft.essence).toBe('Imponente, sofisticada e ambiciosa.');
  });
});

describe('mergeProfileResults', () => {
  const um = (draft: object, notFound: string[] = [], evidence = {}) =>
    ({ draft, evidence, notFound, warnings: [], status: 'ok', quotesChecked: true }) as never;

  it('junta listas sem repetir e texto igual não duplica', () => {
    const r = mergeProfileResults([
      um({ palette: [{ hex: '#111111' }], essence: 'Forte e sofisticada.', neverDo: ['A'] }),
      um({ palette: [{ hex: '#111111' }, { hex: '#222222' }], essence: 'Forte e sofisticada.', neverDo: ['a', 'B'] }),
    ]);
    expect(r.draft.palette).toEqual([{ hex: '#111111' }, { hex: '#222222' }]);
    expect(r.draft.essence).toBe('Forte e sofisticada.');
    expect(r.draft.neverDo).toEqual(['A', 'B']);
  });

  it('texto diferente do mesmo campo em arquivos diferentes é somado', () => {
    const r = mergeProfileResults([um({ artDirection: 'Respiro.' }), um({ artDirection: 'Elegância.' })]);
    expect(r.draft.artDirection).toBe('Respiro.\n\nElegância.');
  });

  it('"não encontrado" num arquivo mas achado em outro não é "não encontrado"', () => {
    const r = mergeProfileResults([um({}, ['essence', 'logo']), um({ essence: 'Achei.' }, ['palette'])]);
    expect(r.notFound.sort()).toEqual(['logo', 'palette']);
  });
});

describe('extractProfileFromManual', () => {
  const clienteComResposta = (texto: string | Error) => {
    const generateContent = vi.fn(async () => {
      if (texto instanceof Error) throw texto;
      return { text: texto };
    });
    const client: GeminiExtractionClient = {
      models: { generateContent },
      files: { upload: vi.fn(), delete: vi.fn() },
    };
    return { client, generateContent };
  };

  const json = JSON.stringify({
    palette: [{ hex: '#582731', quote: 'Paleta: #582731', page: 7 }],
    notFound: ['essence'],
  });

  it('texto puro: uma chamada, com o texto no prompt, e os trechos são conferidos', async () => {
    const { client, generateContent } = clienteComResposta(json);
    const r = await extractProfileFromManual({ client, brandName: 'Assinatura', parts: [], sourceText: MANUAL });

    expect(r.status).toBe('ok');
    expect(r.quotesChecked).toBe(true);
    expect(r.draft.palette).toEqual([{ hex: '#582731' }]);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify((generateContent.mock.calls[0] as unknown as [{ contents: unknown }])[0].contents);
    expect(sent).toContain('Assinatura');
    expect(sent).toContain('Evitar poluição');
  });

  it('um PDF por chamada, mais uma para as imagens', async () => {
    const { client, generateContent } = clienteComResposta(json);
    const r = await extractProfileFromManual({
      client,
      brandName: 'X',
      parts: [
        { kind: 'pdf', buffer: Buffer.from('%PDF-1.4 a'), fileName: 'a.pdf' },
        { kind: 'pdf', buffer: Buffer.from('%PDF-1.4 b'), fileName: 'b.pdf' },
        { kind: 'image', mimeType: 'image/png', data: 'AAAA', fileName: 'c.png' },
      ],
    });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(r.status).toBe('ok');
    expect(r.quotesChecked).toBe(false);
  });

  it('resposta que não é JSON na primeira tentativa: tenta de novo e funciona', async () => {
    const generateContent = vi.fn().mockResolvedValueOnce({ text: 'desculpe, não consegui' }).mockResolvedValueOnce({ text: json });
    const client: GeminiExtractionClient = { models: { generateContent }, files: { upload: vi.fn(), delete: vi.fn() } };

    const r = await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(r.status).toBe('ok');
    expect(r.draft.palette).toEqual([{ hex: '#582731' }]);
  });

  it('erro do provedor na primeira tentativa: tenta de novo', async () => {
    const generateContent = vi.fn().mockRejectedValueOnce(new Error('503 sobrecarregado')).mockResolvedValueOnce({ text: json });
    const client: GeminiExtractionClient = { models: { generateContent }, files: { upload: vi.fn(), delete: vi.fn() } };

    const r = await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(r.status).toBe('ok');
  });

  it('usa temperatura 0 e JSON', async () => {
    const { client, generateContent } = clienteComResposta(json);
    await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });
    const call = generateContent.mock.calls[0] as unknown as [{ config: { temperature: number; responseMimeType: string } }];
    expect(call[0].config).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
  });

  it('só a primeira tentativa usa temperatura 0; as de repetição usam a padrão', async () => {
    const generateContent = vi.fn().mockResolvedValueOnce({ text: '{ quebrado' }).mockResolvedValueOnce({ text: json });
    const client: GeminiExtractionClient = { models: { generateContent }, files: { upload: vi.fn(), delete: vi.fn() } };
    await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });
    const cfg = (i: number) => (generateContent.mock.calls[i] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(cfg(0).temperature).toBe(0);
    expect(cfg(1)).not.toHaveProperty('temperature');
  });

  it('uma chamada falha e outra funciona: parcial, com o motivo', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({ text: json })
      .mockRejectedValue(new Error('503 sobrecarregado'));
    const client: GeminiExtractionClient = { models: { generateContent }, files: { upload: vi.fn(), delete: vi.fn() } };

    const r = await extractProfileFromManual({
      client,
      brandName: 'X',
      parts: [
        { kind: 'pdf', buffer: Buffer.from('%PDF-1.4 a'), fileName: 'a.pdf' },
        { kind: 'pdf', buffer: Buffer.from('%PDF-1.4 b'), fileName: 'b.pdf' },
      ],
    });
    expect(r.status).toBe('partial');
    expect(r.draft.palette).toEqual([{ hex: '#582731' }]);
    expect(r.reason).toContain('503 sobrecarregado');
  });

  it('tudo falha: failed, rascunho vazio e nada inventado', async () => {
    const { client, generateContent } = clienteComResposta(new Error('sem cota'));
    const r = await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });
    expect(r.status).toBe('failed');
    expect(r.draft).toEqual({});
    expect(r.reason).toContain('sem cota');
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('sem nenhum material: failed, sem chamar a IA', async () => {
    const { client, generateContent } = clienteComResposta(json);
    const r = await extractProfileFromManual({ client, brandName: 'X', parts: [] });
    expect(r.status).toBe('failed');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('resposta que não é JSON conta como falha daquela chamada', async () => {
    const { client, generateContent } = clienteComResposta('desculpe, não consegui');
    const r = await extractProfileFromManual({ client, brandName: 'X', parts: [], sourceText: MANUAL });
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('não é JSON');
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
});

describe('buildProfilePrompt', () => {
  it('cita a marca, proíbe inventar e manda não preencher logo nem arquivos', () => {
    const p = buildProfilePrompt('Assinatura');
    expect(p).toContain('"Assinatura"');
    expect(p).toContain('Nunca invente');
    expect(p).toContain('NÃO preencha logo, manual visual nem arquivos');
    expect(p).toContain('notFound');
  });

  it('inclui o texto do material, com teto', () => {
    const p = buildProfilePrompt('X', 'a'.repeat(100_000));
    expect(p.length).toBeLessThan(70_000);
    expect(p).toContain('TEXTO DO MATERIAL');
  });
});

describe('plainTextFromHtml', () => {
  it('tira script, estilo e tags, e decodifica o básico', () => {
    expect(plainTextFromHtml('<style>a{}</style><h1>Tom &amp; voz</h1><script>x()</script><p>Quase&nbsp;sempre &lt;3</p>')).toBe('Tom & voz Quase sempre <3');
  });
});
