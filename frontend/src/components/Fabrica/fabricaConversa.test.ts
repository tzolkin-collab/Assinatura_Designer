import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Tela da conversa da Fábrica (23/11/2026). Acima do slide havia quatro faixas (Aprovação,
// abas com Baixar/Hospedar, status do Canva e "Salvo"); em 1024 a barra quebrava em três
// linhas e no celular as faixas tomavam o preview inteiro, sem slide nenhum à vista.
// Estes testes seguram o que tirou essas faixas do caminho.

const SRC = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const pagina = ler('app', '[marca]', 'fabrica', 'page.tsx');
const painel = ler('components', 'Fabrica', 'ArtifactPanel.tsx');
const painelCss = ler('components', 'Fabrica', 'ArtifactPanel.module.css');

describe('aprovação junto do pedido', () => {
  it('a faixa "Aprovação: Auto | Manual" acima do preview saiu', () => {
    expect(pagina).not.toContain('previewBarLabel');
    expect(pagina).not.toContain('modeToggle');
  });

  it('virou um botão na caixa que alterna entre aprovar sozinha e aprovar cada peça', () => {
    expect(pagina).toContain('Aprovo cada peça');
    expect(pagina).toContain("aria-pressed={reviewMode === 'manual'}");
    expect(pagina).toContain("setReviewMode(reviewMode === 'manual' ? 'auto' : 'manual')");
  });
});

describe('barra do artefato', () => {
  it('não quebra linha; o que não cabe some pela largura do painel', () => {
    expect(painelCss).toMatch(/\.toolbar \{[^}]*flex-wrap: nowrap;/);
    expect(painelCss).toContain('container-type: inline-size;');
    expect(painelCss).toMatch(/@container \(max-width: 560px\) \{\s*\.optional/);
  });

  it('o status do Canva só aparece com vínculo ou envio em curso; senão o envio fica no menu Baixar', () => {
    expect(painel).toContain('{postId && (canvaDesignId || exportandoCanva) && (');
    expect(painel).toMatch(/!canvaDesignId && \([\s\S]*'Enviar para o Canva'/);
  });

  it('o ZIP diz "imagens", não "imagemns"', () => {
    expect(painel).not.toContain("imagem${slideCount > 1 ? 'ns' : ''}");
  });
});

describe('palco do slide', () => {
  it('"Salvo" fixo saiu; só "Salvando rascunho…" enquanto gera', () => {
    expect(pagina).toContain("{saveStatus === 'saving' && (");
    expect(pagina).not.toMatch(/<Check size=\{12\} \/> Salvo/);
  });

  it('setas e miniaturas numa linha só', () => {
    expect(pagina).toMatch(/className=\{s\.slideNav\}>[\s\S]*?className=\{s\.thumbStrip\}[\s\S]*?aria-label="Próximo slide"/);
  });
});
