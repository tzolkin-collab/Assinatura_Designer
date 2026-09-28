// Registro dos turnos do cérebro em andamento, por sessão.
//
// Serve a duas coisas: (1) saber se o cérebro está OCUPADO — a orientação em tempo
// real só faz sentido se houver quem a consuma; (2) poder interromper o stream
// ("Pausar e enviar") via AbortController mantendo o texto parcial. Vive em memória
// do processo da API porque é onde os turnos do cérebro rodam (o pipeline é que pode
// estar em outro processo, e esse é sinalizado por Redis — ver lib/interrupt.ts).

export interface BrainTurn {
  id: number;
  sessionId: string;
  controller: AbortController;
  /** Resolve quando o turno terminou de vez (inclusive de persistir o texto parcial). */
  done: Promise<void>;
}

const turns = new Map<string, Set<BrainTurn>>();
let nextId = 1;

/** Abre o turno. Chame `end()` no `finally`: ele libera quem espera em `done`. */
export function beginBrainTurn(sessionId: string): { turn: BrainTurn; end: () => void } {
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  const turn: BrainTurn = { id: nextId++, sessionId, controller: new AbortController(), done };

  let set = turns.get(sessionId);
  if (!set) { set = new Set(); turns.set(sessionId, set); }
  set.add(turn);

  return {
    turn,
    end: () => {
      const s = turns.get(sessionId);
      s?.delete(turn);
      if (s && s.size === 0) turns.delete(sessionId);
      release();
    },
  };
}

export function hasActiveBrainTurn(sessionId: string): boolean {
  return (turns.get(sessionId)?.size ?? 0) > 0;
}

/**
 * Aborta todos os turnos da sessão e espera terminarem (com teto). Devolve quantos
 * turnos estavam ativos. O teto existe para o pedido do usuário nunca ficar preso
 * atrás de um turno que não responde ao abort (ex.: dentro de uma skill).
 */
export async function abortBrainTurns(sessionId: string, waitMs = 15_000): Promise<number> {
  const active = [...(turns.get(sessionId) ?? [])];
  for (const t of active) t.controller.abort();
  if (active.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(active.map((t) => t.done)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
    clearTimeout(timer);
  }
  return active.length;
}
