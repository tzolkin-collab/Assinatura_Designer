// Cérebro global: a regra única de "o cérebro está ligado?" que a API (chat) e o worker (geração) leem.
// Sem banco real: o Prisma é simulado. O que se prova aqui é a lógica de ligar/desligar, não a geração.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  fails: false,
  lookups: 0,
}));

vi.mock('../lib/prisma.js', () => ({
  default: {
    brand: {
      findUnique: vi.fn(async () => {
        h.lookups++;
        if (h.fails) throw new Error('relation "BrandProfile" does not exist');
        return h.row;
      }),
    },
  },
}));

import {
  isBrainActiveForBrand,
  isBrainOnWithoutProfile,
  isGlobalBrainEnabled,
} from '../lib/designerBrain/index';

const FICHA = { name: 'Marca', kind: 'BASE', collab: null, profile: { data: { essence: 'X' } }, parent: null };

const keys = ['DESIGNER_BRAIN_GLOBAL', 'DESIGNER_BRAIN_BRANDS'] as const;
const originais = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of keys) delete process.env[k];
  h.row = null;
  h.fails = false;
  h.lookups = 0;
});
afterEach(() => {
  for (const k of keys) {
    if (originais[k] === undefined) delete process.env[k];
    else process.env[k] = originais[k];
  }
});

describe('DESIGNER_BRAIN_GLOBAL (saída de emergência)', () => {
  it('ligado por padrão: ausente, vazio ou qualquer valor que não seja "desligar"', () => {
    for (const v of [undefined, '', '  ', 'on', '1', 'true', 'yes', 'sim']) expect(isGlobalBrainEnabled(v)).toBe(true);
  });

  it('off, 0, false e no desligam, sem diferenciar maiúscula nem espaço', () => {
    for (const v of ['off', 'OFF', ' Off ', '0', 'false', 'FALSE', 'no']) expect(isGlobalBrainEnabled(v)).toBe(false);
  });

  it('lê o ambiente na hora da chamada (não na importação)', () => {
    expect(isGlobalBrainEnabled()).toBe(true);
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    expect(isGlobalBrainEnabled()).toBe(false);
  });
});

describe('isBrainOnWithoutProfile (a regra que o pipeline e o chat compartilham)', () => {
  it('por padrão liga em qualquer marca, com ou sem lista', () => {
    expect(isBrainOnWithoutProfile('qualquer-marca', undefined, undefined)).toBe(true);
    expect(isBrainOnWithoutProfile('qualquer-marca', undefined, 'outra')).toBe(true);
  });

  it('com a saída de emergência só liga as marcas de DESIGNER_BRAIN_BRANDS', () => {
    expect(isBrainOnWithoutProfile('amanda-coelho', 'off', 'amanda-coelho')).toBe(true);
    expect(isBrainOnWithoutProfile('rubrica', 'off', 'amanda-coelho')).toBe(false);
    expect(isBrainOnWithoutProfile('rubrica', 'off', undefined)).toBe(false);
  });
});

describe('isBrainActiveForBrand (chat/API)', () => {
  it('padrão: ativo SEM ficha e sem sequer consultar o banco', async () => {
    expect(await isBrainActiveForBrand('marca-sem-ficha')).toBe(true);
    expect(h.lookups).toBe(0);
  });

  it('padrão: ativo também COM ficha', async () => {
    h.row = FICHA;
    expect(await isBrainActiveForBrand('marca')).toBe(true);
  });

  it('padrão: ativo mesmo se o banco falhar ao ler a ficha', async () => {
    h.fails = true;
    expect(await isBrainActiveForBrand('marca')).toBe(true);
  });

  it('saída de emergência: sem ficha e fora da lista, desligado (comportamento anterior)', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    expect(await isBrainActiveForBrand('marca-sem-ficha')).toBe(false);
    expect(h.lookups).toBe(1);
  });

  it('saída de emergência: com ficha salva, ligado', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    h.row = FICHA;
    expect(await isBrainActiveForBrand('marca')).toBe(true);
  });

  it('saída de emergência: slug em DESIGNER_BRAIN_BRANDS liga sem consultar o banco', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    process.env.DESIGNER_BRAIN_BRANDS = 'amanda-coelho';
    expect(await isBrainActiveForBrand('Amanda-Coelho')).toBe(true);
    expect(h.lookups).toBe(0);
  });

  it('saída de emergência: banco fora e sem lista, desligado (a geração segue como antes)', async () => {
    process.env.DESIGNER_BRAIN_GLOBAL = 'off';
    h.fails = true;
    expect(await isBrainActiveForBrand('marca')).toBe(false);
  });

  it('API e worker concordam: a decisão do pipeline (ficha OU regra compartilhada) é a do chat em todas as combinações', async () => {
    for (const globalEnv of [undefined, 'off']) {
      for (const lista of [undefined, 'marca']) {
        for (const ficha of [false, true]) {
          if (globalEnv === undefined) delete process.env.DESIGNER_BRAIN_GLOBAL;
          else process.env.DESIGNER_BRAIN_GLOBAL = globalEnv;
          if (lista === undefined) delete process.env.DESIGNER_BRAIN_BRANDS;
          else process.env.DESIGNER_BRAIN_BRANDS = lista;
          h.row = ficha ? FICHA : null;
          // O pipeline: `layers !== null || isBrainOnWithoutProfile(slug)`.
          const doPipeline = ficha || isBrainOnWithoutProfile('marca');
          expect(await isBrainActiveForBrand('marca'), `global=${globalEnv} lista=${lista} ficha=${ficha}`).toBe(doPipeline);
        }
      }
    }
  });
});
