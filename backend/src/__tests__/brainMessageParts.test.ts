import { describe, it, expect } from 'vitest';
import { buildMessageParts } from '../lib/chatMessageParts';

describe('buildMessageParts', () => {
  it('sem anexo, devolve só a parte de texto', () => {
    const parts = buildMessageParts('Faça um post sobre lançamento', undefined);
    expect(parts).toEqual([{ text: 'Faça um post sobre lançamento' }]);
  });

  it('com anexo de imagem, manda inlineData de verdade — antes só listava o nome em texto', () => {
    const parts = buildMessageParts('Use esta foto no design', [
      { name: 'produto.png', mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);

    expect(parts[0]).toEqual({ text: 'Use esta foto no design' });
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png' && p.inlineData?.data === 'QUJD')).toBe(true);
    // A imagem ainda vem nomeada em texto, mas ALÉM do pixel — não em vez dele
    expect(parts.some((p) => p.text?.includes('produto.png'))).toBe(true);
  });

  it('encaminha PDF como inlineData para o Gemini', () => {
    const parts = buildMessageParts('Leia o arquivo de logos', [
      { name: 'logos.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0=' },
    ]);

    expect(parts).toContainEqual({ text: '[PDF anexado pelo usuário: logos.pdf]' });
    expect(parts).toContainEqual({ inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } });
  });

  it('limita a 5 anexos, mesmo total aceito pela Fábrica', () => {
    const attachments = Array.from({ length: 6 }, (_, i) => ({
      name: `foto-${i}.png`, mimeType: 'image/png', dataBase64: `DATA${i}`,
    }));
    const parts = buildMessageParts('Várias fotos', attachments);

    const inlineCount = parts.filter((p) => p.inlineData).length;
    expect(inlineCount).toBe(5);
    expect(parts.some((p) => p.text?.includes('foto-5.png'))).toBe(false);
  });

  it('array de anexos vazio se comporta como sem anexo', () => {
    expect(buildMessageParts('Oi', [])).toEqual([{ text: 'Oi' }]);
  });
});
