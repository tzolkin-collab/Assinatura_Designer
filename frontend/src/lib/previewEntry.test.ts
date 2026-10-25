import { describe, expect, it } from 'vitest';
import { readPreviewCode, sessionCookie } from './previewEntry';

const CODE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43 caracteres, como o backend emite

describe('readPreviewCode', () => {
  it('lê o código do fragmento', () => {
    expect(readPreviewCode(`#code=${CODE}`)).toBe(CODE);
    expect(readPreviewCode(`code=${CODE}`)).toBe(CODE);
  });

  it('recusa fragmento vazio, sem code, curto, com caracteres estranhos ou em query string', () => {
    expect(readPreviewCode('')).toBeNull();
    expect(readPreviewCode('#')).toBeNull();
    expect(readPreviewCode('#outro=1')).toBeNull();
    expect(readPreviewCode('#code=curto')).toBeNull();
    expect(readPreviewCode(`#code=${CODE}<script>`)).toBeNull();
    expect(readPreviewCode(`?code=${CODE}`)).toBeNull();
  });
});

describe('sessionCookie', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');

  it('dura até o fim da sessão, com SameSite=Strict', () => {
    const cookie = sessionCookie('mcpv_x', '2026-10-25T14:00:00Z', { secure: false, nowMs: now });
    expect(cookie).toBe('auth_token=mcpv_x; path=/; max-age=7200; SameSite=Strict');
  });

  it('em https leva Secure', () => {
    expect(sessionCookie('mcpv_x', '2026-10-25T14:00:00Z', { secure: true, nowMs: now })).toMatch(/; Secure$/);
  });

  it('nunca tem validade negativa', () => {
    expect(sessionCookie('mcpv_x', '2026-10-25T11:00:00Z', { secure: false, nowMs: now })).toContain('max-age=0');
  });
});
