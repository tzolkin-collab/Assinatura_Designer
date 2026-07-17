import { describe, it, expect, vi } from 'vitest';
import { generateIRDesignProgressive } from '../lib/irDesign';

const BARRA = String.fromCharCode(92);
const NL = String.fromCharCode(10);

// O style bible é o mecanismo de COESÃO: manda usar SOMENTE a paleta e as fontes da
// marca em todos os lotes. Ele era montado com `join('\\n')` — barra invertida + n
// como TEXTO, não quebra de linha — então chegava no Gemini achatado numa linha só,
// com os `\n` visíveis no meio. As regras viravam ruído. O mesmo valia para o
// esqueleto dos slides e o contexto dos lotes anteriores.
// Este teste olha o prompt REAL que sai para o modelo.
describe('prompt do IR: formatação enviada ao Gemini', () => {
  const slideValido = {
    id: 'slide-0',
    background: { type: 'solid', color: '#111111' },
    elements: [
      {
        id: 't0',
        type: 'text',
        role: 'title',
        bounds: { x: 100, y: 100, width: 800, height: 200 },
        zIndex: 1,
        content: 'Título real',
        style: { fontFamily: 'Inter', fontSize: 90, color: '#ffffff' },
      },
    ],
  };

  const entrada = {
    prompt: 'deck institucional',
    format: 'presentation' as const,
    width: 1920,
    height: 1080,
    slideCount: 1,
    brand: {
      name: 'Marca',
      colors: ['#111111', '#E8C4A0'],
      primaryFonts: ['Inter', 'Playfair Display'],
    },
    skeleton: [{ title: 'Capa', goal: 'abrir o deck', layout_type: 'hero', order: 0 }],
  };

  it('envia quebras de linha reais — nunca a sequência barra-n como texto', async () => {
    const capturado: Array<{ system: string; user: string }> = [];
    const generateText = vi.fn(async (system: string, user: string) => {
      capturado.push({ system, user });
      return JSON.stringify({ reasoning: 'direção', fonts: ['Inter'], slides: [slideValido] });
    });

    await generateIRDesignProgressive(generateText, entrada as never, (raw) =>
      JSON.parse(raw as string),
    );

    expect(capturado.length).toBeGreaterThan(0);
    const { system, user } = capturado[0]!;

    for (const [nome, texto] of [['systemInstruction', system], ['userPrompt', user]] as const) {
      expect(texto.includes(BARRA + 'n'), `${nome} contém barra-n como texto`).toBe(false);
      expect(texto.includes(NL), `${nome} não tem quebra de linha real`).toBe(true);
    }
  });

  it('entrega o style bible em linhas separadas, não num blob', async () => {
    const capturado: string[] = [];
    const generateText = vi.fn(async (system: string) => {
      capturado.push(system);
      return JSON.stringify({ reasoning: 'direção', fonts: ['Inter'], slides: [slideValido] });
    });

    await generateIRDesignProgressive(generateText, entrada as never, (raw) =>
      JSON.parse(raw as string),
    );

    const linhas = capturado[0]!.split(NL);
    // Cada regra do bible precisa ocupar a própria linha para o modelo lê-las como regras.
    expect(linhas.some((l) => l.startsWith('- Paleta canônica'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('- Tipografia canônica'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('- SLIDE 1:'))).toBe(true);
  });
});
