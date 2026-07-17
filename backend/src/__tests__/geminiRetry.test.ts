import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './client';
import type { GoogleGenAI } from '@google/genai';
import { generateWithRetry, resetModelBreakers, timeoutForModel, tierOf, humanizeGeminiError } from '../lib/geminiRetry';
import { resetThrottle, throttleState } from '../lib/aiThrottle';
import { config } from '../config';

/** O que o SDK lança quando o AbortSignal.timeout dispara. */
function timeoutDoAbort() {
  return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
}

/** Erro de sobrecarga, como o provedor devolve quando o modelo está lotado. */
function sobrecarga() {
  return Object.assign(new Error('The model is overloaded (high demand). 503'), { status: 503 });
}

/**
 * Rate limit: NÓS passamos do teto de chamadas por minuto (a paralelização do deck faz
 * isso sozinha). O modelo está saudável — só pediu para irmos mais devagar.
 */
function rateLimit(retryDelay?: string) {
  const corpo = retryDelay
    ? `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${retryDelay}"}]}}`
    : '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}';
  return Object.assign(new Error(corpo), { status: 429 });
}

/** Blip de rede: o mesmo modelo volta a funcionar em seguida. */
function blipDeRede() {
  return Object.assign(new Error('fetch failed'), { code: 'UND_ERR_SOCKET' });
}

/**
 * Conta sem crédito. Chega como 429, igualzinho ao rate limit — e é o oposto dele:
 * nenhum modelo responde, esperar não adianta, só recarregar resolve. Texto real
 * devolvido pelo provedor (capturado em 14/07/2026).
 */
function semCredito() {
  const corpo =
    '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}';
  return Object.assign(new Error(corpo), { status: 429 });
}

function fakeAi(impl: (model: string) => Promise<unknown>) {
  const generateContent = vi.fn(async ({ model }: { model: string }) => impl(model));
  return {
    ai: { models: { generateContent } } as unknown as GoogleGenAI,
    generateContent,
  };
}

const resposta = { text: 'ok', usageMetadata: { totalTokenCount: 10 } };

describe('Retry, fallback e circuit breaker do Gemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelBreakers();
    resetThrottle();
  });

  it('modelo lotado: UMA tentativa e cai para o próximo (não insiste 3x)', async () => {
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash') throw sobrecarga();
      return resposta;
    });

    const res = await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });

    expect(res).toBe(resposta);
    // Antes: 3 tentativas no lotado (com 1s + 2s de backoff) antes de trocar — ~17s
    // queimados por chamada. Agora: uma tentativa e vai embora.
    const tentativasNoLotado = generateContent.mock.calls.filter(
      (c) => (c[0] as { model: string }).model === 'gemini-3.5-flash',
    );
    expect(tentativasNoLotado).toHaveLength(1);
  });

  it('params.model vale como preferência quando preferredModel é omitido (bug 3.3)', async () => {
    // Antes o params.model era IGNORADO sem o 2º argumento: ~10 chamadas pedindo
    // flash-lite rodavam no tier rápido (3.5-flash, ~6x o preço) sem ninguém pedir.
    const { ai, generateContent } = fakeAi(async () => resposta);

    await generateWithRetry(ai, { model: 'gemini-2.5-flash-lite', contents: 'oi' });

    const primeiro = (generateContent.mock.calls[0]?.[0] as { model: string }).model;
    expect(primeiro).toBe('gemini-2.5-flash-lite');
  });

  it('blip de rede: insiste no MESMO modelo (ele costuma voltar)', async () => {
    let chamadas = 0;
    const { ai, generateContent } = fakeAi(async () => {
      chamadas++;
      if (chamadas === 1) throw blipDeRede();
      return resposta;
    });

    const res = await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-2.5-flash');

    expect(res).toBe(resposta);
    expect(generateContent.mock.calls.every((c) => (c[0] as { model: string }).model === 'gemini-2.5-flash')).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2); // falhou, esperou, tentou de novo
  });

  it('erro não retentável estoura na hora, sem gastar em outro modelo', async () => {
    const { ai, generateContent } = fakeAi(async () => {
      throw Object.assign(new Error('API key inválida'), { status: 401 });
    });

    await expect(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' })).rejects.toThrow('API key inválida');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('circuit breaker: depois de lotar repetido, o modelo é PULADO nas chamadas seguintes', async () => {
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash') throw sobrecarga();
      return resposta;
    });

    // Duas chamadas descobrem a lotação (limiar do breaker = 2 falhas).
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
    generateContent.mockClear();

    // A terceira já não perde tempo com o lotado: vai direto no saudável.
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });

    const modelosTentados = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(modelosTentados).toEqual(['gemini-2.5-flash']);
  });

  it('circuito aberto não impede o modelo preferido de ser tentado se for o único caminho', async () => {
    // Todos lotados: tentar um lotado ainda é melhor do que falhar sem tentar.
    const { ai, generateContent } = fakeAi(async () => {
      throw sobrecarga();
    });

    await expect(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' })).rejects.toBeDefined();
    await expect(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' })).rejects.toBeDefined();
    generateContent.mockClear();

    await expect(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' })).rejects.toBeDefined();
    expect(generateContent.mock.calls.length).toBeGreaterThan(0); // tentou mesmo assim
  });

  describe('timeout por tentativa', () => {
    it('o corte é pelo peso do MODELO, não pela feature', () => {
      // Editar um slide parece leve, mas roda no pro e legitimamente passa de 25s.
      expect(timeoutForModel('gemini-3.1-pro-preview')).toBe(config.aiTimeoutHeavyMs);
      expect(timeoutForModel('gemini-2.5-pro')).toBe(config.aiTimeoutHeavyMs);
      // Já um flash que demora está doente: 70s para responder "oi".
      expect(timeoutForModel('gemini-3.5-flash')).toBe(config.aiTimeoutLightMs);
      expect(timeoutForModel('gemini-2.5-flash')).toBe(config.aiTimeoutLightMs);
    });

    it('cada tentativa vai com um abortSignal (senão o modelo lento nunca é cortado)', async () => {
      const { ai, generateContent } = fakeAi(async () => resposta);

      await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-2.5-flash');

      const params = generateContent.mock.calls[0]![0] as { config?: { abortSignal?: AbortSignal } };
      expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('respeita o abortSignal que o chamador já passou (não cancela por baixo dele)', async () => {
      const { ai, generateContent } = fakeAi(async () => resposta);
      const meuSinal = new AbortController().signal;

      await generateWithRetry(
        ai,
        { model: 'gemini-3.5-flash', contents: 'oi', config: { abortSignal: meuSinal } },
        'gemini-2.5-flash',
      );

      const params = generateContent.mock.calls[0]![0] as { config?: { abortSignal?: AbortSignal } };
      expect(params.config?.abortSignal).toBe(meuSinal);
    });

    it('modelo lento: aborta, NÃO insiste e cai para o próximo', async () => {
      const { ai, generateContent } = fakeAi(async (model) => {
        if (model === 'gemini-3.5-flash') throw timeoutDoAbort();
        return resposta;
      });

      const res = await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });

      expect(res).toBe(resposta);
      const tentativasNoLento = generateContent.mock.calls.filter(
        (c) => (c[0] as { model: string }).model === 'gemini-3.5-flash',
      );
      expect(tentativasNoLento).toHaveLength(1); // uma e vai embora
    });

    it('modelo lento repetido entra no breaker e some das chamadas seguintes', async () => {
      const { ai, generateContent } = fakeAi(async (model) => {
        if (model === 'gemini-3.5-flash') throw timeoutDoAbort();
        return resposta;
      });

      await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
      await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
      generateContent.mockClear();

      await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });

      const modelos = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
      expect(modelos).toEqual(['gemini-2.5-flash']); // nem tenta o lento
    });
  });

  it('modelo INTERMITENTE também é pulado: um acerto no meio não apaga as falhas', async () => {
    // O caso real, medido: o modelo estourou o tempo, respondeu (o que zerava a conta
    // na versão antiga do breaker) e estourou de novo — e a chamada seguinte pagava a
    // espera outra vez, porque o circuito nunca abria. As falhas contam por JANELA.
    let vez = 0;
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model !== 'gemini-3.5-flash') return resposta;
      vez++;
      if (vez === 2) return resposta; // acerta na segunda
      throw sobrecarga();
    });

    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }); // falha -> fallback
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }); // ACERTA
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }); // falha de novo -> abre
    generateContent.mockClear();

    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });

    const modelos = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(modelos).toEqual(['gemini-2.5-flash']); // nem tenta o intermitente
  });

  it('depois do cooldown o modelo volta a ser tentado (não fica banido para sempre)', async () => {
    let ruim = true;
    const { ai, generateContent } = fakeAi(async (model) => {
      if (model === 'gemini-3.5-flash' && ruim) throw sobrecarga();
      return resposta;
    });

    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }); // abre o circuito

    ruim = false;
    resetModelBreakers(); // simula o fim do cooldown
    generateContent.mockClear();

    await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' });
    expect((generateContent.mock.calls[0]![0] as { model: string }).model).toBe('gemini-3.5-flash');
  });

  /**
   * O bug que custava a estética do deck: um 429 — provocado pela NOSSA paralelização —
   * era lido como "esse modelo é ruim". O pro caía para o flash na primeira oscilação e,
   * em duas oscilações, o breaker o bania por 3 minutos. Metade do deck saía com a mão
   * de outro modelo. 429 não é defeito do modelo; é a cota pedindo calma.
   */
  describe('rate limit (429) é oscilação de cota, não modelo ruim', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Deixa o backoff correr sem esperar de verdade. */
    async function comTemposAdiantados<T>(p: Promise<T>): Promise<T> {
      await vi.runAllTimersAsync();
      return p;
    }

    it('insiste no MESMO modelo em vez de desistir na primeira oscilação', async () => {
      let chamadas = 0;
      const { ai, generateContent } = fakeAi(async () => {
        chamadas++;
        if (chamadas <= 2) throw rateLimit(); // oscila duas vezes e volta
        return resposta;
      });

      const res = await comTemposAdiantados(
        generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'),
      );

      expect(res).toBe(resposta);
      // O ponto: NENHUMA das tentativas trocou de modelo. Esperou e insistiu.
      const modelos = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
      expect(modelos).toEqual([
        'gemini-3.1-pro-preview',
        'gemini-3.1-pro-preview',
        'gemini-3.1-pro-preview',
      ]);
    });

    it('NÃO alimenta o circuit breaker: o modelo segue preferido na chamada seguinte', async () => {
      let primeiraChamada = true;
      const { ai, generateContent } = fakeAi(async () => {
        if (primeiraChamada) {
          primeiraChamada = false;
          throw rateLimit();
        }
        return resposta;
      });

      // Duas oscilações seriam suficientes para o breaker banir o modelo, se 429 contasse.
      await comTemposAdiantados(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'));
      generateContent.mockClear();

      await comTemposAdiantados(generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'));

      // Se o 429 tivesse alimentado o breaker, esta chamada começaria no 2.5-pro.
      expect((generateContent.mock.calls[0]![0] as { model: string }).model).toBe('gemini-3.1-pro-preview');
    });

    it('rajada de 429 simultâneos vale UM corte, não oito (senão a janela desaba a 1)', async () => {
      // O cenário real: os 8 lotes paralelos do deck estouram a cota juntos e voltam com
      // 429 no mesmo instante. São 8 avisos do MESMO congestionamento — cortar a janela
      // 8 vezes seria entrar em pânico por um evento só.
      let chamadas = 0;
      const { ai } = fakeAi(async () => {
        chamadas++;
        if (chamadas <= 8) throw rateLimit('0s');
        return resposta;
      });

      const antes = throttleState('gemini-3.1-pro-preview').limit;
      const rajada = Promise.all(
        Array.from({ length: 8 }, () =>
          generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'),
        ),
      );
      await comTemposAdiantados(rajada);

      expect(throttleState('gemini-3.1-pro-preview').limit).toBe(Math.floor(antes / 2));
    });

    it('cota que não melhora: a torneira fecha até o mínimo, mas nunca até zero', async () => {
      const { ai } = fakeAi(async () => {
        throw rateLimit();
      });

      await comTemposAdiantados(
        generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview').catch(() => undefined),
      );

      // Cada rodada de congestionamento corta pela metade (8→4→2→1). Uma janela de 1
      // ainda progride — em fila. Zero travaria a geração inteira para sempre.
      expect(throttleState('gemini-3.1-pro-preview').limit).toBe(1);
    });

    it('obedece o retryDelay que o provedor mandou em vez de chutar backoff', async () => {
      let chamadas = 0;
      const { ai } = fakeAi(async () => {
        chamadas++;
        if (chamadas === 1) throw rateLimit('7s');
        return resposta;
      });

      const p = generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview');

      // Antes dos 7s pedidos, ninguém retentou.
      await vi.advanceTimersByTimeAsync(6000);
      expect(chamadas).toBe(1);

      // Passados os 7s (+ até 1s de jitter), a segunda tentativa acontece.
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toBe(resposta);
      expect(chamadas).toBe(2);
    });
  });

  /**
   * "Nunca misturar a mão": o deck é gerado no pro. Cair para o flash não é usar o
   * modelo reserva — é trocar de designer no meio do trabalho. Inconsistência salta aos
   * olhos muito mais do que mediocridade uniforme.
   */
  describe('tiers estéticos: uma chamada nunca cruza de tier', () => {
    it('o pro lotado cai para outro PRO, jamais para um flash', async () => {
      const { ai, generateContent } = fakeAi(async (model) => {
        if (model === 'gemini-3.1-pro-preview') throw sobrecarga();
        return resposta;
      });

      await generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview');

      const modelos = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
      expect(modelos).toEqual(['gemini-3.1-pro-preview', 'gemini-2.5-pro']);
      expect(modelos.some((m) => m.includes('flash'))).toBe(false);
    });

    it('esgotado o tier do artista, a chamada FALHA — não entrega arte de outra mão', async () => {
      const { ai, generateContent } = fakeAi(async () => {
        throw sobrecarga();
      });

      await expect(
        generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'),
      ).rejects.toBeDefined();

      // Quem chamou decide o que fazer (o irDesign põe placeholder on-brand, que é
      // neutro). O que NÃO pode é o deck ganhar slides com a assinatura de outro modelo.
      const modelos = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
      expect(modelos.every((m) => m.includes('pro'))).toBe(true);
    });

    it('classifica modelo desconhecido pelo nome, para não degradar a arte em silêncio', () => {
      expect(tierOf('gemini-3.1-pro-preview')).toBe('artista');
      expect(tierOf('gemini-9-pro-experimental')).toBe('artista'); // ainda não existe
      expect(tierOf('gemini-2.5-flash')).toBe('rapido');
      expect(tierOf('gemini-2.5-flash-lite')).toBe('barato');
    });
  });

  // Este é o bug que travou os decks de 30 slides por dois dias: a conta ficou sem
  // crédito, o Google devolveu 429, e o sistema tratou como "vamos rápido demais" —
  // esperou, insistiu, trocou de modelo e disse ao usuário para tentar de novo.
  describe('conta sem crédito: 429 que NÃO é rate limit', () => {
    it('estoura na PRIMEIRA tentativa, sem insistir nem trocar de modelo', async () => {
      const { ai, generateContent } = fakeAi(async () => {
        throw semCredito();
      });

      await expect(
        generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'),
      ).rejects.toThrow(/credits are depleted/i);

      // UMA chamada. Antes eram 6 tentativas × 2 modelos do tier = ~85s queimados
      // esperando por algo que jamais ia passar.
      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('não fecha a torneira do AIMD (não há congestionamento nosso: inFlight=0)', async () => {
      const { ai } = fakeAi(async () => {
        throw semCredito();
      });

      const antes = throttleState('gemini-3.1-pro-preview').limit;
      await expect(
        generateWithRetry(ai, { model: 'gemini-3.5-flash', contents: 'oi' }, 'gemini-3.1-pro-preview'),
      ).rejects.toBeDefined();

      expect(throttleState('gemini-3.1-pro-preview').limit).toBe(antes);
    });

    it('diz a VERDADE ao usuário: recarregue os créditos, esperar não resolve', () => {
      const msg = humanizeGeminiError(semCredito());

      expect(msg).toMatch(/sem cr[ée]ditos/i);
      expect(msg).toMatch(/ai\.studio/i);
      // O pecado antigo: mandar esperar/tentar de novo quando isso nunca vai funcionar.
      expect(msg).not.toMatch(/tente novamente daqui a pouco/i);
    });
  });
});
