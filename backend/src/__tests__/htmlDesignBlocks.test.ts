import { describe, it, expect } from 'vitest';
import { assetsBlock, presentationConfigBlock, referencesBlock, learnedPreferencesBlock } from '../lib/htmlDesign';

describe('assetsBlock', () => {
  it('vazio/undefined não gera bloco', () => {
    expect(assetsBlock(undefined)).toBe('');
    expect(assetsBlock([])).toBe('');
  });

  it('inclui NOME junto da URL — antes só mandava a URL crua, sem pista do conteúdo', () => {
    const block = assetsBlock([{ url: 'https://cdn.example.com/logo.png', name: 'Logo oficial' }]);
    expect(block).toContain('Logo oficial');
    expect(block).toContain('https://cdn.example.com/logo.png');
  });

  it('capa em 8 assets mesmo recebendo mais', () => {
    const assets = Array.from({ length: 12 }, (_, i) => ({ url: `https://cdn.example.com/${i}.png`, name: `Asset ${i}` }));
    const block = assetsBlock(assets);
    expect(block).toContain('Asset 7');
    expect(block).not.toContain('Asset 8');
  });
});

describe('presentationConfigBlock', () => {
  it('undefined ou objeto vazio não gera bloco', () => {
    expect(presentationConfigBlock(undefined)).toBe('');
    expect(presentationConfigBlock({})).toBe('');
  });

  it('inclui vibe, paleta, ousadia e preferência de fotos quando presentes', () => {
    const block = presentationConfigBlock({
      visualVibe: 'editorial minimalista',
      paletteApproved: ['#111111', '#F5F5F5'],
      boldness: 'bold',
      photoPreference: 'high',
    });
    expect(block).toContain('editorial minimalista');
    expect(block).toContain('#111111, #F5F5F5');
    expect(block).toContain('ousado, quebre convenções');
    expect(block).toContain('alta, use foto sempre que fizer sentido');
  });

  it('traduz boldness "safe" e photoPreference "minimal" corretamente', () => {
    const block = presentationConfigBlock({ boldness: 'safe', photoPreference: 'minimal' });
    expect(block).toContain('seguro/conservador');
    expect(block).toContain('mínima, priorize tipografia/forma');
  });

  it('só inclui campos que existem, ignora os ausentes', () => {
    const block = presentationConfigBlock({ visualVibe: 'clean' });
    expect(block).toContain('clean');
    expect(block).not.toContain('paleta aprovada');
    expect(block).not.toContain('undefined');
  });
});

describe('referencesBlock', () => {
  it('undefined ou array vazio não gera bloco', () => {
    expect(referencesBlock(undefined)).toBe('');
    expect(referencesBlock([])).toBe('');
  });

  it('inclui nome, arquétipo/tom, paleta e um recorte do insight', () => {
    const block = referencesBlock([
      {
        name: 'Concorrente X',
        archetype: 'O Criador',
        toneOfVoice: 'Autoridade Direta',
        palette: ['#FF0000', '#00FF00'],
        insightsText: 'Usa muito espaço em branco e tipografia serifada em títulos grandes.',
      },
    ]);
    expect(block).toContain('Concorrente X');
    expect(block).toContain('O Criador');
    expect(block).toContain('Autoridade Direta');
    expect(block).toContain('#FF0000, #00FF00');
    expect(block).toContain('espaço em branco');
  });

  it('capa em 4 referências mesmo recebendo mais', () => {
    const refs = Array.from({ length: 6 }, (_, i) => ({ name: `Ref ${i}` }));
    const block = referencesBlock(refs);
    expect(block).toContain('Ref 3');
    expect(block).not.toContain('Ref 4');
  });
});

describe('learnedPreferencesBlock', () => {
  it('undefined ou vazio não gera bloco', () => {
    expect(learnedPreferencesBlock(undefined)).toBe('');
    expect(learnedPreferencesBlock({})).toBe('');
  });

  it('renderiza cada preferência aprendida como linha de regra', () => {
    const block = learnedPreferencesBlock({ 'não gosto de azul': true, tom: 'informal e direto' });
    expect(block).toContain('não gosto de azul');
    expect(block).toContain('tom: informal e direto');
  });

  it('valores não-string viram JSON (não [object Object])', () => {
    const block = learnedPreferencesBlock({ paleta_proibida: ['#0000FF'] });
    expect(block).toContain('["#0000FF"]');
  });
});
