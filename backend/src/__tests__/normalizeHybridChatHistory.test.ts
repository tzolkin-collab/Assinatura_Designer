import { describe, it, expect } from 'vitest';
import { normalizeHybridChatHistory } from '../routes/ai';

// Teste de CARACTERIZAÇÃO: trava o comportamento ATUAL de normalizeHybridChatHistory
// antes de ela migrar para services/designGeneration.ts (Fase 3). Depois da
// extração, este teste deve continuar verde só trocando o path de import — é isso
// que prova que a refatoração preservou o comportamento.

const msg = (over: Record<string, unknown> = {}) => ({
  role: 'user',
  content: 'oi',
  timestamp: 1,
  ...over,
});

describe('normalizeHybridChatHistory (caracterização)', () => {
  it('não-array → undefined', () => {
    expect(normalizeHybridChatHistory('x')).toBeUndefined();
    expect(normalizeHybridChatHistory(null)).toBeUndefined();
    expect(normalizeHybridChatHistory(undefined)).toBeUndefined();
  });

  it('array vazio ou só de itens inválidos → undefined', () => {
    expect(normalizeHybridChatHistory([])).toBeUndefined();
    expect(normalizeHybridChatHistory([{ role: 'root' }, 42, null])).toBeUndefined();
  });

  it('descarta role fora de {user,assistant,system}', () => {
    expect(normalizeHybridChatHistory([msg({ role: 'admin' })])).toBeUndefined();
    expect(normalizeHybridChatHistory([msg({ role: 'assistant' })])).toHaveLength(1);
    expect(normalizeHybridChatHistory([msg({ role: 'system' })])).toHaveLength(1);
  });

  it('descarta content não-string e timestamp não-finito', () => {
    expect(normalizeHybridChatHistory([msg({ content: 123 })])).toBeUndefined();
    expect(normalizeHybridChatHistory([msg({ timestamp: 'agora' })])).toBeUndefined();
    expect(normalizeHybridChatHistory([msg({ timestamp: Infinity })])).toBeUndefined();
  });

  it('mantém válidos preservando a ordem', () => {
    const out = normalizeHybridChatHistory([msg({ content: 'a', timestamp: 1 }), msg({ content: 'b', timestamp: 2 })]);
    expect(out?.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('trunca para as últimas 40 mensagens', () => {
    const many = Array.from({ length: 45 }, (_, i) => msg({ content: `m${i}`, timestamp: i }));
    const out = normalizeHybridChatHistory(many);
    expect(out).toHaveLength(40);
    expect(out?.[0]?.content).toBe('m5');
    expect(out?.[39]?.content).toBe('m44');
  });

  it('filtra anexos inválidos e limita a 6', () => {
    const attachments = [
      ...Array.from({ length: 8 }, (_, i) => ({ name: `a${i}`, mimeType: 'image/png', dataBase64: 'x' })),
      { name: 123, mimeType: 'image/png', dataBase64: 'x' }, // inválido: name não-string
    ];
    const out = normalizeHybridChatHistory([msg({ attachments })]);
    expect(out?.[0]?.attachments).toHaveLength(6);
  });

  it('mensagem sem array de anexos → attachments undefined', () => {
    const out = normalizeHybridChatHistory([msg()]);
    expect(out?.[0]?.attachments).toBeUndefined();
  });
});
