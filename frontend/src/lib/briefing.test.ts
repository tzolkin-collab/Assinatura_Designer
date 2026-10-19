import { describe, expect, it } from 'vitest';
import { composeBriefing, EMPTY_BRIEFING, filledFields, isBriefingEmpty } from './briefing';

describe('composeBriefing', () => {
  it('sem briefing devolve a mensagem intacta', () => {
    expect(composeBriefing('faça 5 slides', EMPTY_BRIEFING)).toBe('faça 5 slides');
    expect(isBriefingEmpty(EMPTY_BRIEFING)).toBe(true);
  });

  it('cada campo vira o bloco do seu status; a mensagem do chat vira apoio', () => {
    const out = composeBriefing('faça 5 slides', {
      approved: 'Slide 1: Varejo+',
      context: 'Roteiro de fala do evento',
      internal: 'Não citar o concorrente',
    });
    expect(out).toBe(
      '[APOIO]\nfaça 5 slides\n\n[APROVADO]\nSlide 1: Varejo+\n\n[CONTEXTO]\nRoteiro de fala do evento\n\n[INTERNO]\nNão citar o concorrente',
    );
  });

  it('campos vazios não geram bloco', () => {
    const out = composeBriefing('', { approved: 'Só o texto', context: '', internal: '  ' });
    expect(out).toBe('[APROVADO]\nSó o texto');
  });

  it('uma marca digitada dentro de um campo não muda o status do bloco', () => {
    const out = composeBriefing('', { approved: '[INTERNO] segredo\nlinha dois', context: '', internal: '' });
    expect(out).toBe('[APROVADO]\n(INTERNO) segredo\nlinha dois');
  });

  it('conta os campos preenchidos', () => {
    expect(filledFields({ approved: 'a', context: ' ', internal: 'c' })).toBe(2);
  });
});
