import { describe, it, expect } from 'vitest';
import { buildSlidesHtmlBlob, detectAssetUrlsInHtml, mergeUsedAssetUrls } from '../lib/assetUsage';

describe('buildSlidesHtmlBlob', () => {
  it('concatena html e css de todos os slides', () => {
    const blob = buildSlidesHtmlBlob([
      { html: '<div>A</div>', css: '.a{color:red}' },
      { html: '<div>B</div>', css: '.b{color:blue}' },
    ]);
    expect(blob).toContain('<div>A</div>');
    expect(blob).toContain('.a{color:red}');
    expect(blob).toContain('<div>B</div>');
    expect(blob).toContain('.b{color:blue}');
  });

  it('tolera slides sem css e array vazio', () => {
    expect(buildSlidesHtmlBlob([{ html: '<div>Só HTML</div>' }])).toContain('<div>Só HTML</div>');
    expect(buildSlidesHtmlBlob([])).toBe('');
  });
});

describe('detectAssetUrlsInHtml', () => {
  const htmlBlob = '<img src="https://cdn.example.com/logo.png"><div style="background:url(https://cdn.example.com/bg.jpg)"></div>';

  it('encontra URLs oferecidas que aparecem literalmente no HTML/CSS final', () => {
    const result = detectAssetUrlsInHtml(htmlBlob, [
      'https://cdn.example.com/logo.png',
      'https://cdn.example.com/bg.jpg',
    ]);
    expect(result).toEqual(['https://cdn.example.com/logo.png', 'https://cdn.example.com/bg.jpg']);
  });

  it('ignora URLs oferecidas que o artista NÃO usou', () => {
    const result = detectAssetUrlsInHtml(htmlBlob, ['https://cdn.example.com/nunca-usado.png']);
    expect(result).toEqual([]);
  });

  it('ignora string vazia na lista de candidatos (não dá match falso-positivo em blob vazio)', () => {
    expect(detectAssetUrlsInHtml('', [''])).toEqual([]);
  });
});

describe('mergeUsedAssetUrls', () => {
  it('une detectados + resolvidos, sem duplicar', () => {
    const result = mergeUsedAssetUrls(
      ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      ['https://cdn.example.com/b.png', 'https://cdn.example.com/c.png'],
    );
    expect(result.sort()).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
      'https://cdn.example.com/c.png',
    ]);
  });

  it('descarta undefined da lista de resolvidos (slide sem imagem resolvida)', () => {
    const result = mergeUsedAssetUrls(['https://cdn.example.com/a.png'], [undefined, undefined]);
    expect(result).toEqual(['https://cdn.example.com/a.png']);
  });

  it('vazio + vazio = vazio', () => {
    expect(mergeUsedAssetUrls([], [])).toEqual([]);
  });
});
