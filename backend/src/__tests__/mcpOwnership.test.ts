import { describe, it, expect } from 'vitest';
import { withServerOwnedMcp } from '../lib/mcpOwnership';

const guardado = { kind: 'html-design', mcp: { userId: 'agente-1', clientId: 'chatgpt' } };

describe('withServerOwnedMcp (B6: o dono da peça de agente é do servidor)', () => {
  it('mantém o marcador guardado quando o corpo o omite (regravação do editor)', () => {
    const out = withServerOwnedMcp({ kind: 'html-design', fonts: ['Inter'] }, guardado);
    expect(out).toMatchObject({ mcp: guardado.mcp, fonts: ['Inter'] });
  });

  it('descarta um marcador forjado pelo cliente', () => {
    const out = withServerOwnedMcp({ kind: 'html-design', mcp: { userId: 'atacante' } }, guardado) as { mcp: unknown };
    expect(out.mcp).toEqual(guardado.mcp);
  });

  it('não cria marcador em peça comum', () => {
    const out = withServerOwnedMcp({ kind: 'html-design', mcp: { userId: 'atacante' } }, { kind: 'html-design' });
    expect(out).not.toHaveProperty('mcp');
  });

  it('não mexe em corpo que não é objeto', () => {
    expect(withServerOwnedMcp(null, guardado)).toBeNull();
    expect(withServerOwnedMcp('texto', guardado)).toBe('texto');
    expect(withServerOwnedMcp([1], guardado)).toEqual([1]);
  });

  it('conteúdo guardado nulo ou estranho não quebra', () => {
    expect(withServerOwnedMcp({ a: 1 }, null)).toEqual({ a: 1 });
    expect(withServerOwnedMcp({ a: 1 }, 'x')).toEqual({ a: 1 });
  });
});
