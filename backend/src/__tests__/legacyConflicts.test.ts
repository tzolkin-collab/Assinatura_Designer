import { describe, expect, it } from 'vitest';
import { legacyContextOf, reviewLegacyNotes, describeLegacyConflict } from '../lib/legacyConflicts.js';

// Notas reais da marca tzolkin (cadastro antigo, copiado para `legacyNotes` na migração para a ficha).
const TZOLKIN_NOTES = [
  'Diretrizes (antes da ficha):',
  '{"name":"Tzolkin","history":"Estética: dark-first. Nunca: clipart, sombras duras."}',
  '',
  'Instruções do agente (antes da ficha):',
  'REGRAS DE DESIGN (siga em todos os slides):',
  '1. Fundos: alterne entre #0A0E1A (base), #101828 e um slide ocasional claro #F5F7FA para respiro.',
  '2. Acentos: violeta elétrico #7C5CFF para destaque principal, verde #00E5A0 para números positivos/métricas.',
  '3. DADOS E GRÁFICOS: desenhe gráficos com CSS puro — barras e donuts (conic-gradient). Nunca invente proporção.',
  '4. IMAGENS: use fotos reais do Unsplash (URLs https válidas de images.unsplash.com com parâmetros w=1600&q=80).',
  '5. NÚMEROS GRANDES: métricas-chave em 120-180px.',
  '6. LAYOUTS: varie de verdade. Nunca dois slides seguidos com o mesmo layout.',
  '7. Tipografia: Space Grotesk para display/títulos, Inter para corpo. Contraste WCAG sempre.',
].join('\n');

const FICHA = legacyContextOf({
  palette: [{ hex: '#000000' }, { hex: '#FFFFFF' }, { hex: '#CCCCCC' }, { hex: '#333333' }, { hex: '#EEEEEE' }],
  typography: [{ family: 'Montserrat' }, { family: 'Inter' }],
});

describe('reviewLegacyNotes', () => {
  it('acha os conflitos reais da tzolkin e tira essas linhas do texto que o agente lê', () => {
    const r = reviewLegacyNotes(TZOLKIN_NOTES, FICHA);

    const kinds = r.conflicts.map((c) => c.kind).sort();
    expect(kinds).toEqual(['color', 'color', 'font', 'stock-image']);

    expect(r.kept).not.toMatch(/unsplash/i);
    expect(r.kept).not.toMatch(/space grotesk/i);
    expect(r.kept).not.toMatch(/#7C5CFF|#0A0E1A/i);

    // O que não contradiz continua: dados, números grandes, variação de layout e o cadastro antigo.
    expect(r.kept).toContain('DADOS E GRÁFICOS');
    expect(r.kept).toContain('NÚMEROS GRANDES');
    expect(r.kept).toContain('LAYOUTS: varie de verdade');
    expect(r.kept).toContain('"name":"Tzolkin"');
  });

  it('cada conflito aponta a linha e a regra violada', () => {
    const r = reviewLegacyNotes(TZOLKIN_NOTES, FICHA);
    const stock = r.conflicts.find((c) => c.kind === 'stock-image')!;
    expect(stock.excerpt).toContain('Unsplash');
    expect(stock.rule).toMatch(/banco de imagem/i);

    const font = r.conflicts.find((c) => c.kind === 'font')!;
    expect(font.rule).toContain('Montserrat, Inter');
    expect(font.rule).toContain('Space Grotesk');
    expect(font.rule).not.toMatch(/está fora dela.*Inter/); // Inter está na ficha: não é conflito

    const cor = r.conflicts.find((c) => c.kind === 'color')!;
    expect(cor.rule).toMatch(/#0A0E1A/);
    expect(describeLegacyConflict(stock)).toMatch(/^Nota antiga ignorada: ".*Unsplash/);
  });

  it('texto limpo passa intacto, sem falso positivo', () => {
    const limpo = [
      'Tom sério e direto.',
      'Tipografia: Montserrat para títulos, Inter para corpo.',
      'Use #000000 e #ffffff com respiro. Fotos reais fornecidas pela marca.',
      'Nunca gere pessoas fictícias por IA.',
    ].join('\n');
    const r = reviewLegacyNotes(limpo, FICHA);
    expect(r.conflicts).toEqual([]);
    expect(r.kept).toBe(limpo);
  });

  it('gerar pessoa sintética é conflito; a linha que já proíbe não é', () => {
    const r = reviewLegacyNotes('Gere pessoas fictícias por IA para ilustrar os slides.\nNunca gere pessoa fictícia por IA.', FICHA);
    expect(r.conflicts.map((c) => c.kind)).toEqual(['ai-person']);
    expect(r.kept).toBe('Nunca gere pessoa fictícia por IA.');
  });

  it('sem paleta ou sem tipografia na ficha, não julga cor nem fonte', () => {
    const r = reviewLegacyNotes('Fundo #0A0E1A.\nTipografia: Space Grotesk para títulos.', legacyContextOf({}));
    expect(r.conflicts).toEqual([]);
    expect(r.kept).toContain('#0A0E1A');
  });

  it('cor da paleta vale em qualquer caixa e fonte compara sem acento nem espaço', () => {
    const r = reviewLegacyNotes('Fundo #eeeeee.\nFonte: montserrat para títulos.', FICHA);
    expect(r.conflicts).toEqual([]);
  });

  it('vazio ou ausente devolve vazio', () => {
    expect(reviewLegacyNotes(undefined, FICHA)).toEqual({ kept: '', conflicts: [] });
    expect(reviewLegacyNotes('   ', FICHA)).toEqual({ kept: '', conflicts: [] });
  });
});
