import { describe, expect, it } from 'vitest';
import { canExport, canPreview, canWrite, describeAccess, formatRemaining, isLocalServerUrl, mcpServerUrl, plainText, roleLabel } from './mcp';

describe('plainText', () => {
  it('desfaz as entidades que o servidor escapou', () => {
    expect(plainText('Barra &amp; Cia')).toBe('Barra & Cia');
    expect(plainText('&lt;b&gt;x&lt;/b&gt;')).toBe('<b>x</b>');
    expect(plainText('Nome &quot;A&quot; &#39;B&#39;')).toBe('Nome "A" \'B\'');
  });

  it('não interpreta outras entidades nem faz decodificação dupla', () => {
    expect(plainText('&amp;lt;')).toBe('&lt;');
    expect(plainText('&nbsp;')).toBe('&nbsp;');
  });
});

describe('mcpServerUrl', () => {
  it('usa a origem da API e põe /mcp na raiz do host', () => {
    expect(mcpServerUrl('https://api.exemplo.com/api')).toBe('https://api.exemplo.com/mcp');
    expect(mcpServerUrl('http://localhost:4000/api')).toBe('http://localhost:4000/mcp');
    expect(mcpServerUrl('https://api.exemplo.com')).toBe('https://api.exemplo.com/mcp');
  });

  it('valor inválido não quebra a tela', () => {
    expect(mcpServerUrl('não é url')).toBe('/mcp');
  });
});

describe('isLocalServerUrl', () => {
  it('reconhece endereço que o ChatGPT e o Claude não alcançam', () => {
    expect(isLocalServerUrl('http://localhost:4000/mcp')).toBe(true);
    expect(isLocalServerUrl('http://api.exemplo.com/mcp')).toBe(true);
    expect(isLocalServerUrl('https://127.0.0.1/mcp')).toBe(true);
    expect(isLocalServerUrl('https://api.exemplo.com/mcp')).toBe(false);
  });
});

describe('acesso em palavras', () => {
  it('escrita implica "ver e salvar"; leitura é só ver', () => {
    expect(canWrite(['designer.write', 'designer.read'])).toBe(true);
    expect(describeAccess(['designer.read'])).toBe('Só ver');
    expect(describeAccess(['designer.write'])).toBe('Ver e salvar peças');
    expect(describeAccess(['designer.read', 'designer.write', 'designer.edit_all'])).toBe('Ver e editar todas as peças');
    expect(canWrite(['designer.edit_all'])).toBe(true);
  });

  it('exportar é à parte: não vem de ler nem de escrever', () => {
    expect(canExport(['designer.read', 'designer.write', 'designer.edit_all'])).toBe(false);
    expect(canExport(['designer.read', 'designer.export'])).toBe(true);
    expect(describeAccess(['designer.read', 'designer.export'])).toBe('Só ver · pode exportar');
    expect(describeAccess(['designer.write', 'designer.export'])).toBe('Ver e salvar peças · pode exportar');
    expect(describeAccess(['designer.export'])).toBe('Só ver · pode exportar');
  });

  it('navegador (só leitura) é escopo à parte e aparece na descrição', () => {
    expect(canPreview(['designer.read'])).toBe(false);
    expect(canPreview(['designer.read', 'designer.preview'])).toBe(true);
    expect(describeAccess(['designer.read', 'designer.preview'])).toBe('Só ver · abre o Designer no navegador (só leitura)');
  });

  it('papel e tempo restante', () => {
    expect(roleLabel('EDITOR')).toBe('Editor');
    expect(formatRemaining(540)).toBe('9 min');
    expect(formatRemaining(30)).toBe('30 s');
    expect(formatRemaining(0)).toBe('expirado');
  });
});
