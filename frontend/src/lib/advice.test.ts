import { describe, it, expect } from 'vitest';
import {
  applyAdviceEvent,
  hydrateAdviceList,
  isSessionBusy,
  decideEnterAction,
  matchSlashCommand,
  adviceStatusLabel,
  type AdviceItem,
} from './advice';

const item = (over: Partial<AdviceItem> = {}): AdviceItem => ({
  id: 'a-1',
  text: 'use fundo escuro',
  createdAt: 1,
  status: 'pending',
  ...over,
});

describe('applyAdviceEvent (reducer puro dos eventos advice.*)', () => {
  it('advice.queued adiciona um item novo', () => {
    const result = applyAdviceEvent([], 'advice.queued', { item: item() });
    expect(result).toEqual([item()]);
  });

  it('advice.queued reenviado (reconexão) não duplica — substitui pelo id', () => {
    const list = [item()];
    const result = applyAdviceEvent(list, 'advice.queued', { item: item({ text: 'texto atualizado' }) });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('texto atualizado');
  });

  it('advice.applied atualiza status e etapa do item existente', () => {
    const list = [item()];
    const applied = item({ status: 'applied', stage: 'lote 3 de 10', appliedAt: 99 });
    const result = applyAdviceEvent(list, 'advice.applied', { item: applied });
    expect(result).toEqual([applied]);
  });

  it('advice.applied para item que o cliente ainda não tinha visto (perdeu o queued) insere mesmo assim', () => {
    const applied = item({ status: 'applied', stage: 'revisor' });
    const result = applyAdviceEvent([], 'advice.applied', { item: applied });
    expect(result).toEqual([applied]);
  });

  it('advice.updated troca o texto sem mexer no status', () => {
    const list = [item()];
    const updated = item({ text: 'novo texto', updatedAt: 5 });
    const result = applyAdviceEvent(list, 'advice.updated', { item: updated });
    expect(result[0].text).toBe('novo texto');
  });

  it('advice.removed tira o item da lista pelo id', () => {
    const list = [item(), item({ id: 'a-2' })];
    const result = applyAdviceEvent(list, 'advice.removed', { id: 'a-1' });
    expect(result.map((i) => i.id)).toEqual(['a-2']);
  });

  it('advice.expired também tira da lista — o texto volta pro campo por outro caminho, não fica pendurado aqui', () => {
    const list = [item()];
    const result = applyAdviceEvent(list, 'advice.expired', { item: item({ status: 'expired' }) });
    expect(result).toEqual([]);
  });

  it('evento sem item nem id não quebra e devolve a lista igual', () => {
    const list = [item()];
    expect(applyAdviceEvent(list, 'advice.updated', {})).toBe(list);
    expect(applyAdviceEvent(list, 'advice.removed', {})).toBe(list);
  });

  it('remover/expirar um id que não está na lista é no-op (corrida: já tinha sumido)', () => {
    const list = [item()];
    expect(applyAdviceEvent(list, 'advice.removed', { id: 'nao-existe' })).toEqual(list);
  });
});

describe('hydrateAdviceList (reidratação total no reconnect)', () => {
  it('aceita um array de itens válidos', () => {
    const server = [item(), item({ id: 'a-2', status: 'applied' })];
    expect(hydrateAdviceList(server)).toEqual(server);
  });

  it('devolve lista vazia para algo que não é array (campo ausente no session:state)', () => {
    expect(hydrateAdviceList(undefined)).toEqual([]);
    expect(hydrateAdviceList(null)).toEqual([]);
  });

  it('filtra entradas malformadas (sem id) em vez de quebrar a tela', () => {
    const bom = item();
    expect(hydrateAdviceList([bom, {}, null, 'lixo'])).toEqual([bom]);
  });
});

describe('isSessionBusy (portão do modo ocupado)', () => {
  it('ocupado quando o cérebro está fazendo stream', () => {
    expect(isSessionBusy(true, 'idle')).toBe(true);
  });

  it('ocupado quando o pipeline está rodando', () => {
    expect(isSessionBusy(false, 'running')).toBe(true);
  });

  it('livre quando nenhum dos dois está acontecendo', () => {
    expect(isSessionBusy(false, 'idle')).toBe(false);
    expect(isSessionBusy(false, 'done')).toBe(false);
    expect(isSessionBusy(false, 'error')).toBe(false);
  });
});

describe('decideEnterAction (o que Enter faz, dado o estado)', () => {
  const base = { shiftKey: false, ctrlKey: false, slashOpen: false, busy: false, hasText: true };

  it('menu de slash aberto tem prioridade sobre tudo', () => {
    expect(decideEnterAction({ ...base, slashOpen: true, busy: true, ctrlKey: true })).toBe('slash');
  });

  it('Shift+Enter é sempre nova linha, mesmo ocupado', () => {
    expect(decideEnterAction({ ...base, shiftKey: true, busy: true })).toBe('newline');
    expect(decideEnterAction({ ...base, shiftKey: true, busy: false })).toBe('newline');
  });

  it('sem texto não faz nada', () => {
    expect(decideEnterAction({ ...base, hasText: false })).toBe('noop');
    expect(decideEnterAction({ ...base, hasText: false, busy: true })).toBe('noop');
  });

  it('livre + Enter simples envia mensagem normal', () => {
    expect(decideEnterAction({ ...base })).toBe('message');
  });

  it('livre + Ctrl+Enter também envia mensagem normal (nada para interromper)', () => {
    expect(decideEnterAction({ ...base, ctrlKey: true })).toBe('message');
  });

  it('ocupado + Enter simples vira orientação', () => {
    expect(decideEnterAction({ ...base, busy: true })).toBe('advice');
  });

  it('ocupado + Ctrl+Enter interrompe e envia agora', () => {
    expect(decideEnterAction({ ...base, busy: true, ctrlKey: true })).toBe('interrupt');
  });
});

describe('matchSlashCommand (comando digitado literal não vira orientação/mensagem)', () => {
  const commands = [
    { id: 'editor', label: '/editor' },
    { id: 'brandbook', label: '/brandbook' },
  ] as const;

  it('bate com o rótulo exato', () => {
    expect(matchSlashCommand('/editor', commands)).toEqual({ id: 'editor', label: '/editor' });
  });

  it('ignora espaços nas pontas e caixa (o usuário pode digitar "/Editor ")', () => {
    expect(matchSlashCommand('  /Editor ', commands)).toEqual({ id: 'editor', label: '/editor' });
  });

  it('não bate com prefixo — só o comando sozinho no campo conta', () => {
    expect(matchSlashCommand('/editor por favor', commands)).toBeUndefined();
    expect(matchSlashCommand('/edito', commands)).toBeUndefined();
  });

  it('texto comum (uma orientação de verdade) não bate com nada', () => {
    expect(matchSlashCommand('use fundo escuro', commands)).toBeUndefined();
  });

  it('texto vazio não bate (evita achar o "primeiro" comando por engano)', () => {
    expect(matchSlashCommand('', commands)).toBeUndefined();
    expect(matchSlashCommand('   ', commands)).toBeUndefined();
  });
});

describe('adviceStatusLabel (rótulo pt-BR da lista "Orientações")', () => {
  it('pendente', () => {
    expect(adviceStatusLabel(item({ status: 'pending' }))).toBe('pendente');
  });

  it('aplicada com etapa', () => {
    expect(adviceStatusLabel(item({ status: 'applied', stage: 'lote 3 de 10' }))).toBe('aplicada — lote 3 de 10');
  });

  it('aplicada sem etapa (defensivo — o backend sempre manda, mas não deve quebrar)', () => {
    expect(adviceStatusLabel(item({ status: 'applied' }))).toBe('aplicada');
  });

  it('expirada', () => {
    expect(adviceStatusLabel(item({ status: 'expired' }))).toBe('expirada');
  });
});
