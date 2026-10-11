import { describe, expect, it } from 'vitest';
import { redisEndpointForLogs } from '../config.js';

describe('redisEndpointForLogs', () => {
  it('remove usuário e senha da URI antes de registrar o destino', () => {
    expect(redisEndpointForLogs('redis://user:secret@example.test:6380/0')).toBe('example.test:6380');
  });

  it('trata URL inválida sem devolver o conteúdo recebido', () => {
    expect(redisEndpointForLogs('secret-token')).toBe('URL Redis inválida');
  });
});
