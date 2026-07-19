import { describe, it, expect } from 'vitest';
import {
  extractBracketedJson,
  stripBracketedJson,
  mapDeviationsToEdits,
} from '../lib/tagExtract';

/**
 * Regressão do extrator de tags [EDIT:{...}] e do mapa deviations → edits.
 *
 * A regex antiga do brain (`/\[EDIT:\s*(\{[\s\S]*?\})\s*\]/i`) nasceu quebrada:
 * o quantificador lazy para no PRIMEIRO `}` seguido de `]`, então o payload
 * documentado `[EDIT:{"edits":[{"index":0,"instruction":"..."}]}]` era
 * truncado em `...contraste"}` — JSON inválido, parse sempre falhava, e o
 * strip ainda deixava o resíduo `}]` na mensagem exibida ao usuário.
 *
 * Estas funções são puras (sem redis/prisma/gemini): não precisam do `./client`.
 */

describe('extractBracketedJson', () => {
  it('extrai o payload documentado que a regex antiga truncava', () => {
    // A regex lazy capturava só `{"edits":[{"index":0,"instruction":"Aumentar contraste"}`
    // e o JSON.parse falhava SEMPRE — o [EDIT] nunca funcionou.
    const payload = '[EDIT:{"edits":[{"index":0,"instruction":"Aumentar contraste"}]}]';

    const res = extractBracketedJson(payload, 'EDIT');

    expect(res).not.toBeNull();
    const parsed = JSON.parse(res!.json) as { edits: Array<{ index: number; instruction: string }> };
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0]!.index).toBe(0);
    expect(parsed.edits[0]!.instruction).toBe('Aumentar contraste');
  });

  it('devolve o span total da tag (colchete a colchete), mesmo com texto ao redor', () => {
    const texto = 'Claro, ajustando: [EDIT:{"edits":[]}] pronto.';

    const res = extractBracketedJson(texto, 'EDIT');

    expect(res).not.toBeNull();
    // start/end cobrem a tag INTEIRA — é o que permite o strip cirúrgico.
    expect(texto.slice(res!.start, res!.end)).toBe('[EDIT:{"edits":[]}]');
    // json vem SEM os colchetes da tag, pronto para o JSON.parse.
    expect(res!.json).toBe('{"edits":[]}');
  });

  it('respeita aninhamento profundo de objetos e arrays', () => {
    const payload =
      '[EDIT:{"edits":[{"index":2,"instruction":"Refazer hierarquia","detalhes":{"paleta":{"fundo":"#111","texto":"#eee"},"notas":["a",{"n":1}]}}]}]';

    const res = extractBracketedJson(payload, 'EDIT');

    expect(res).not.toBeNull();
    const parsed = JSON.parse(res!.json);
    expect(parsed.edits[0].detalhes.paleta.fundo).toBe('#111');
    expect(parsed.edits[0].detalhes.notas[1].n).toBe(1);
  });

  it('não se engana com {, } e ] DENTRO de strings do JSON', () => {
    // O pior caso para qualquer scanner ingênuo: a sequência `}]` e uma chave
    // `{` solta dentro do TEXTO da instruction. Um contador que ignora strings
    // desbalanceia; uma busca por `}]` trunca aqui.
    const payload = '[EDIT:{"edits":[{"index":0,"instruction":"abre { e fecha }] dentro"}]}]';

    const res = extractBracketedJson(payload, 'EDIT');

    expect(res).not.toBeNull();
    const parsed = JSON.parse(res!.json);
    expect(parsed.edits[0].instruction).toBe('abre { e fecha }] dentro');
  });

  it('respeita aspas escapadas (\\") sem fechar a string antes da hora', () => {
    // Se o scanner fechar a string no \", o `{` seguinte desbalanceia a
    // contagem e a tag inteira se perde (null).
    const payload = '[EDIT:{"edits":[{"index":0,"instruction":"aspas \\" e { chave"}]}]';

    const res = extractBracketedJson(payload, 'EDIT');

    expect(res).not.toBeNull();
    const parsed = JSON.parse(res!.json);
    expect(parsed.edits[0].instruction).toBe('aspas " e { chave');
  });

  it('respeita contrabarra escapada (\\\\) antes da aspa que fecha de verdade', () => {
    // `\\` é UMA contrabarra: a aspa seguinte fecha a string. Se o scanner a
    // tratar como escapada, a string nunca fecha e o `}` final vira texto.
    const payload = '[EDIT:{"edits":[{"index":0,"instruction":"C:\\\\temp"}]}]';

    const res = extractBracketedJson(payload, 'EDIT');

    expect(res).not.toBeNull();
    const parsed = JSON.parse(res!.json);
    expect(parsed.edits[0].instruction).toBe('C:\\temp');
  });

  it('retorna null quando a tag não existe no texto', () => {
    expect(extractBracketedJson('Texto comum, sem tag nenhuma.', 'EDIT')).toBeNull();
    // Outra tag não conta.
    expect(extractBracketedJson('[QUESTION:{"q":"?"}]', 'EDIT')).toBeNull();
    // Sem os dois pontos não é tag de payload.
    expect(extractBracketedJson('[EDIT] {"a":1}', 'EDIT')).toBeNull();
    // Prefixo não basta: [EDITOR: não é [EDIT:.
    expect(extractBracketedJson('[EDITOR:{"a":1}]', 'EDIT')).toBeNull();
  });

  it('retorna null quando a tag nunca fecha', () => {
    expect(extractBracketedJson('[EDIT:{"a":1', 'EDIT')).toBeNull();
    expect(extractBracketedJson('[EDIT:', 'EDIT')).toBeNull();
    // String que nunca fecha: a chave dentro dela não pode contar.
    expect(extractBracketedJson('[EDIT:{"a":"sem fechar}', 'EDIT')).toBeNull();
  });

  it('reconhece a tag em qualquer caixa ([edit:...], [Edit:...])', () => {
    for (const payload of ['[edit:{"a":1}]', '[Edit:{"a":1}]', '[eDiT:{"a":1}]']) {
      const res = extractBracketedJson(payload, 'EDIT');
      expect(res).not.toBeNull();
      expect(JSON.parse(res!.json)).toEqual({ a: 1 });
    }
  });

  it('tolera espaço depois dos dois pontos e antes do colchete (a regex antiga aceitava)', () => {
    // O extrator substitui `/\[EDIT:\s*(\{...\})\s*\]/i` — não pode ser mais fraco que ela.
    const res = extractBracketedJson('[EDIT:  {"a":1}  ]', 'EDIT');

    expect(res).not.toBeNull();
    expect(JSON.parse(res!.json)).toEqual({ a: 1 });
  });

  it('devolve a PRIMEIRA ocorrência quando há várias tags no texto', () => {
    const texto = '[EDIT:{"a":1}] e depois [EDIT:{"b":2}]';

    const res = extractBracketedJson(texto, 'EDIT');

    expect(res).not.toBeNull();
    expect(JSON.parse(res!.json)).toEqual({ a: 1 });
    expect(texto.slice(res!.start, res!.end)).toBe('[EDIT:{"a":1}]');
  });
});

describe('stripBracketedJson', () => {
  it('remove a tag sem deixar o resíduo "}]" (regressão do strip antigo)', () => {
    // O strip antigo usava a mesma regex lazy: removia até o primeiro `}]` e
    // sobrava `}]` na mensagem que o usuário via no chat.
    const texto = 'Claro! [EDIT:{"edits":[{"index":0,"instruction":"Aumentar contraste"}]}] Pronto.';

    const limpo = stripBracketedJson(texto, 'EDIT');

    expect(limpo).not.toContain('}]');
    expect(limpo).not.toMatch(/\[EDIT/i);
    expect(limpo).toBe('Claro! Pronto.');
  });

  it('remove TODAS as ocorrências, em qualquer caixa', () => {
    const texto = 'A [EDIT:{"x":1}] B [edit:{"y":2}] C [Edit:{"z":3}] D';

    expect(stripBracketedJson(texto, 'EDIT')).toBe('A B C D');
  });

  it('colapsa o whitespace que sobra no lugar da tag', () => {
    const texto = 'Linha um.\n\n[EDIT:{"a":1}]\n\nLinha dois.';

    const limpo = stripBracketedJson(texto, 'EDIT');

    // O buraco deixado pela tag não pode virar um vão de linhas em branco —
    // mas colapsar para um parágrafo (\n\n) é colapso legítimo.
    expect(limpo).not.toMatch(/\n{3,}/);
    expect(limpo).not.toMatch(/\[EDIT/i);
    expect(limpo).toContain('Linha um.');
    expect(limpo).toContain('Linha dois.');
  });

  it('texto sem tag volta INTACTO', () => {
    const texto = 'Mensagem normal,  com espaços   duplos\n\ne quebras de linha.';

    expect(stripBracketedJson(texto, 'EDIT')).toBe(texto);
  });

  it('tag não terminada não engole o texto do usuário', () => {
    const texto = 'Olha isso: [EDIT:{"a":1';

    expect(stripBracketedJson(texto, 'EDIT')).toBe(texto);
  });
});

describe('mapDeviationsToEdits (decline cirúrgico)', () => {
  it('entrada vazia devolve lista vazia', () => {
    expect(mapDeviationsToEdits([], undefined, 10)).toEqual([]);
  });

  it('deduplica por slideIndex: vence a deviation de MAIOR severidade', () => {
    const edits = mapDeviationsToEdits(
      [
        { slideIndex: 3, severity: 'minor', fix: 'ajustar margem' },
        { slideIndex: 3, severity: 'critical', fix: 'refazer o slide inteiro' },
        { slideIndex: 5, severity: 'major', fix: 'trocar a fonte' },
      ],
      undefined,
      10,
    );

    expect(edits).toHaveLength(2);
    // critical > minor, mesmo vindo DEPOIS na lista.
    expect(edits.find((e) => e.index === 3)?.instruction).toBe('refazer o slide inteiro');
  });

  it('no dedupe, deviation sem severidade perde para qualquer uma com severidade', () => {
    const edits = mapDeviationsToEdits(
      [
        { slideIndex: 2, description: 'algo estranho' },
        { slideIndex: 2, severity: 'minor', fix: 'polir o rodapé' },
      ],
      undefined,
      10,
    );

    expect(edits).toHaveLength(1);
    expect(edits[0]!.instruction).toBe('polir o rodapé');
  });

  it('descarta índices fora de [0, totalSlides), mantendo as pontas', () => {
    const edits = mapDeviationsToEdits(
      [
        { slideIndex: -1, severity: 'critical', fix: 'negativo' },
        { slideIndex: 0, severity: 'minor', fix: 'primeiro slide' },
        { slideIndex: 9, severity: 'minor', fix: 'último slide' },
        { slideIndex: 10, severity: 'critical', fix: 'fora do deck' },
      ],
      undefined,
      10,
    );

    expect(edits.map((e) => e.index).sort((a, b) => a - b)).toEqual([0, 9]);
  });

  it('instruction usa fix quando presente; senão, description', () => {
    const edits = mapDeviationsToEdits(
      [
        { slideIndex: 1, severity: 'major', fix: 'corrigir contraste', description: 'contraste baixo' },
        { slideIndex: 2, severity: 'minor', description: 'só tem descrição' },
      ],
      undefined,
      5,
    );

    expect(edits.find((e) => e.index === 1)?.instruction).toBe('corrigir contraste');
    expect(edits.find((e) => e.index === 2)?.instruction).toBe('só tem descrição');
  });

  it('anexa o motivo do decline como contexto do usuário', () => {
    const edits = mapDeviationsToEdits(
      [{ slideIndex: 0, severity: 'major', fix: 'trocar a cor' }],
      'ficou escuro demais',
      5,
    );

    expect(edits[0]!.instruction).toBe('trocar a cor (Contexto do usuário: ficou escuro demais)');
  });

  it('sem motivo, a instruction vai limpa, sem sufixo de contexto', () => {
    const edits = mapDeviationsToEdits(
      [{ slideIndex: 0, severity: 'major', fix: 'trocar a cor' }],
      undefined,
      5,
    );

    expect(edits[0]!.instruction).toBe('trocar a cor');
  });

  it('ordena por severidade: critical > major > minor > ausente', () => {
    const edits = mapDeviationsToEdits(
      [
        { slideIndex: 0, severity: 'minor', fix: 'minor' },
        { slideIndex: 1, severity: 'critical', fix: 'critical' },
        { slideIndex: 2, severity: 'major', fix: 'major' },
        { slideIndex: 3, fix: 'sem severidade' },
      ],
      undefined,
      10,
    );

    expect(edits.map((e) => e.index)).toEqual([1, 2, 0, 3]);
  });

  it('respeita o teto de 8 edits, preservando os mais graves', () => {
    const deviations = [
      ...Array.from({ length: 6 }, (_, i) => ({ slideIndex: i, severity: 'critical', fix: `grave-${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ slideIndex: 10 + i, severity: 'minor', fix: `leve-${i}` })),
    ];

    const edits = mapDeviationsToEdits(deviations, undefined, 20);

    expect(edits).toHaveLength(8);
    // Todos os críticos cabem no teto; quem sobra para o corte é o minor.
    expect(edits.filter((e) => e.instruction.startsWith('grave-'))).toHaveLength(6);
    expect(edits.filter((e) => e.instruction.startsWith('leve-'))).toHaveLength(2);
  });

  it('devolve [] quando TODAS as deviations caem fora do range', () => {
    const edits = mapDeviationsToEdits(
      [{ slideIndex: 99, severity: 'critical', fix: 'não existe' }],
      undefined,
      10,
    );

    expect(edits).toEqual([]);
  });
});
