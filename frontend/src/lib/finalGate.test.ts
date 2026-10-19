import { describe, it, expect, vi } from 'vitest';
import { ApiError } from './api';
import { entregarOuConfirmarRascunho, readFinalGate } from './finalGate';

const recusa = () => new ApiError(409, 'Não dá para publicar como final: texto em revisão.', 'DRAFT_NOT_FINAL');

describe('readFinalGate', () => {
  it('lê pendências e ignora lixo', () => {
    expect(readFinalGate({ finalGate: { blocking: ['a', 1], notes: ['b'] } })).toEqual({ blocking: ['a'], notes: ['b'] });
    expect(readFinalGate({ finalGate: { blocking: [], notes: [] } })).toBeNull();
    expect(readFinalGate(undefined)).toBeNull();
    expect(readFinalGate({ finalGate: 'x' })).toBeNull();
  });
});

describe('entregarOuConfirmarRascunho', () => {
  it('sem recusa, executa uma vez sem perguntar', async () => {
    const executar = vi.fn(async () => 'ok');
    const perguntar = vi.fn(() => true);
    expect(await entregarOuConfirmarRascunho(executar, perguntar)).toBe('ok');
    expect(executar).toHaveBeenCalledTimes(1);
    expect(perguntar).not.toHaveBeenCalled();
  });
  it('recusa do servidor + confirmação repete com confirmarRascunho', async () => {
    const executar = vi.fn(async (c: boolean) => {
      if (!c) throw recusa();
      return 'feito';
    });
    const perguntar = vi.fn((_m: string) => true);
    expect(await entregarOuConfirmarRascunho(executar, perguntar)).toBe('feito');
    expect(perguntar.mock.calls[0]![0]).toContain('texto em revisão');
    expect(executar).toHaveBeenLastCalledWith(true);
  });
  it('recusa do servidor + pessoa desiste não entrega', async () => {
    const executar = vi.fn(async () => {
      throw recusa();
    });
    expect(await entregarOuConfirmarRascunho(executar, () => false)).toBeUndefined();
    expect(executar).toHaveBeenCalledTimes(1);
  });
  it('outros erros seguem para quem chamou', async () => {
    const executar = vi.fn(async () => {
      throw new ApiError(500, 'falhou');
    });
    await expect(entregarOuConfirmarRascunho(executar, () => true)).rejects.toThrow('falhou');
  });
});
