import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { artesRecentes, destinoDaArte } from './RecentArts';
import type { Post } from '@/lib/hooks';

// Fábrica vazia (23/11/2026): a caixa de pedido vai para o centro e as últimas artes da marca
// aparecem embaixo. Estes testes seguram o que escolhe as artes e para onde cada uma leva.

const deck = (sessionId?: string) => ({
  kind: 'html-design', version: 1, width: 1920, height: 1080, fonts: [],
  slides: [{ html: '<h1>x</h1>' }], ...(sessionId ? { sessionId } : {}),
});
const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id, name: id, type: 'PRESENTATION', status: 'READY', createdAt: '2026-11-20', content: deck('s-' + id), ...extra,
});

describe('artes recentes da Fábrica', () => {
  it('pega as seis primeiras prontas, na ordem que a Galeria entrega', () => {
    const lista = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => post(id));
    expect(artesRecentes(lista).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('pula as que falharam, as que ainda estão gerando e as sem capa', () => {
    const lista = [
      post('falhou', { status: 'FAILED' }),
      post('gerando', { status: 'GENERATING' }),
      post('sem-capa', { content: null, previewUrl: null }),
      post('com-imagem', { content: null, previewUrl: 'https://x/capa.png' }),
      post('ok'),
    ];
    expect(artesRecentes(lista).map((p) => p.id)).toEqual(['com-imagem', 'ok']);
  });

  it('reabre a conversa que gerou a arte; sem conversa, abre no editor', () => {
    expect(destinoDaArte('amanda', post('a'))).toBe('/amanda/fabrica?sessionId=s-a');
    expect(destinoDaArte('amanda', post('b', { content: deck() }))).toBe('/amanda/editor/b');
  });
});

describe('layout da Fábrica vazia', () => {
  const pagina = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'app', '[marca]', 'fabrica', 'page.tsx'),
    'utf8',
  );

  it('só entra no modo vazio sem conversa, sem arte e sem nada rodando', () => {
    expect(pagina).toMatch(/const starting =\s*displayMessages\.length === 0 &&\s*currentDesign\.length === 0 &&\s*workerStatus !== 'running' &&\s*!isStreaming &&\s*!activeQuestion;/);
    expect(pagina).toContain('${starting ? s.rootStart : \'\'}');
  });

  it('mostra as últimas artes só no modo vazio', () => {
    expect(pagina).toMatch(/\{starting && \(\s*<div className=\{s\.startRecent\}>\s*<RecentArts/);
  });
});
