import { describe, it, expect, vi } from 'vitest';
import { encryptToken, decryptToken, tryDecryptToken } from '../lib/tokenCrypto';

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      jwtSecret: 'jwt-secret-de-teste-que-tem-mais-de-32-bytes-para-pbkdf2',
      canvaTokenEncryptionKey: '',
    },
  };
});

describe('tokenCrypto', () => {
  it('criptografa e descriptografa um token', () => {
    const original = 'meu-token-secreto-do-canva';
    const encrypted = encryptToken(original);
    expect(encrypted).not.toBe(original);
    expect(decryptToken(encrypted)).toBe(original);
  });

  it('produz ciphertexts diferentes para o mesmo plain text (IV aleatório)', () => {
    const original = 'token';
    const a = encryptToken(original);
    const b = encryptToken(original);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(original);
    expect(decryptToken(b)).toBe(original);
  });

  it('tryDecryptToken descriptografa tokens criptografados', () => {
    const original = 'token';
    const encrypted = encryptToken(original);
    expect(tryDecryptToken(encrypted)).toBe(original);
  });

  it('tryDecryptToken retorna plain text como fallback (migração)', () => {
    const plain = 'token-em-plain-text-antigo';
    expect(tryDecryptToken(plain)).toBe(plain);
  });

  it('tryDecryptToken retorna null para valores vazios', () => {
    expect(tryDecryptToken(null)).toBeNull();
    expect(tryDecryptToken(undefined)).toBeNull();
    expect(tryDecryptToken('')).toBeNull();
  });
});
