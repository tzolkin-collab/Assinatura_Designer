import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BRAND_SETTINGS,
  BRAND_SETTINGS_GROUP,
  BRAND_SETTINGS_OVERVIEW,
  EXTRAS_NAV,
  GLOBAL_NAV,
  brandNav,
  isActivePath,
} from './navigation';

const APP = path.resolve(__dirname, '../app');

const todos = () => [
  ...GLOBAL_NAV,
  ...brandNav('marca'),
  BRAND_SETTINGS_GROUP,
  BRAND_SETTINGS_OVERVIEW,
  ...BRAND_SETTINGS,
  ...EXTRAS_NAV,
];

describe('navegação', () => {
  it('cada item tem um ícone próprio (antes Globe, Eye e Settings se repetiam)', () => {
    const icones = todos().map((i) => i.icon);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it('nenhum nome se repete dentro do mesmo menu', () => {
    const rotulos = todos().map((i) => i.label);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it('os endereços da marca e globais não se repetem', () => {
    const hrefs = [...GLOBAL_NAV, ...brandNav('m'), ...EXTRAS_NAV].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('cada seção de configuração da marca tem uma página de verdade', () => {
    for (const s of BRAND_SETTINGS) {
      const pagina = path.join(APP, '[marca]', 'configuracoes', s.key, 'page.tsx');
      expect(fs.existsSync(pagina), `falta a página de "${s.label}" (${s.key})`).toBe(true);
    }
  });

  it('cada item de navegação da marca e global tem uma página de verdade', () => {
    for (const i of GLOBAL_NAV) {
      const pagina = path.join(APP, ...i.href.split('/').filter(Boolean), 'page.tsx');
      expect(fs.existsSync(pagina), `falta a página de "${i.label}" (${i.href})`).toBe(true);
    }
    for (const i of brandNav('x')) {
      const trecho = i.href.split('/').filter(Boolean).slice(1); // sem o slug
      const pagina = path.join(APP, '[marca]', ...trecho, 'page.tsx');
      expect(fs.existsSync(pagina), `falta a página de "${i.label}" (${i.href})`).toBe(true);
    }
  });

  it('as descrições das seções não prometem o que o sistema não faz (fontes enviadas)', () => {
    const midia = BRAND_SETTINGS.find((s) => s.key === 'midia')!;
    expect(midia.description.toLowerCase()).not.toContain('fonte');
  });
});

describe('isActivePath', () => {
  it('igualdade exata ou prefixo de página interna', () => {
    expect(isActivePath('/a/galeria', '/a/galeria')).toBe(true);
    expect(isActivePath('/a/galeria/x', '/a/galeria')).toBe(true);
  });

  it('não casa por prefixo de texto parecido', () => {
    expect(isActivePath('/a/galeria-velha', '/a/galeria')).toBe(false);
  });

  it('com exact, só a própria página (a "Visão geral" não acende nas filhas)', () => {
    expect(isActivePath('/a/configuracoes', '/a/configuracoes', true)).toBe(true);
    expect(isActivePath('/a/configuracoes/branding', '/a/configuracoes', true)).toBe(false);
  });
});
