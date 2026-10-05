'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import type { GenerationCost } from '@/lib/generationCostFormat';

interface State {
  /** De qual post é `cost`: ao trocar de post, o valor do anterior não pode aparecer no novo. */
  forPostId: string | undefined;
  cost: GenerationCost | null;
  loading: boolean;
  error: string | null;
}

/**
 * Busca o custo estimado do deck (GET /posts/:id/cost).
 *
 * `refreshKey` refaz a busca quando muda (ex.: terminou uma geração, entrou um slide,
 * acabou uma edição por IA). Ao refazer, o valor anterior continua na tela até o novo
 * chegar — piscar um spinner a cada slide durante uma geração seria pior que o número
 * defasado por um instante.
 */
export function useGenerationCost(postId: string | undefined, refreshKey?: string | number) {
  const [state, setState] = useState<State>({ forPostId: postId, cost: null, loading: Boolean(postId), error: null });
  // Só a última requisição pode escrever: durante a geração vários refresh se sobrepõem, e
  // uma resposta antiga chegando depois da nova mostraria um valor menor que o real.
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!postId) return;
    const mine = ++seq.current;
    setState((s) => (s.forPostId === postId ? { ...s, loading: true, error: null } : { forPostId: postId, cost: null, loading: true, error: null }));
    api
      .get<GenerationCost>(`/posts/${postId}/cost`)
      .then((cost) => {
        if (mine === seq.current) setState({ forPostId: postId, cost, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: getApiErrorMessage(err, 'Não consegui carregar o custo estimado.'),
        }));
      });
  }, [postId]);

  // Adia o setState para fora do corpo do efeito (evita render em cascata). Usa setTimeout
  // e não requestAnimationFrame (como o useAiUsage): rAF fica pausado em aba em segundo
  // plano, e o custo só apareceria quando o usuário voltasse à aba — medido, 10 s de atraso.
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load, refreshKey]);

  const current = state.forPostId === postId;
  return {
    cost: current ? state.cost : null,
    // No primeiro instante depois de trocar de post ainda não houve `load`: conta como carregando.
    loading: !current || state.loading,
    error: current ? state.error : null,
    refresh: load,
  };
}
