import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deferLoad } from './deferLoad';

describe('deferLoad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('roda a leitura mesmo quando requestAnimationFrame nunca dispara (aba em segundo plano)', () => {
    // Aba oculta: o navegador não pinta, então rAF não chama o callback.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const load = vi.fn();
    deferLoad(load);

    expect(load).not.toHaveBeenCalled(); // adiado: não roda dentro do corpo do efeito
    vi.advanceTimersByTime(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('o cancelamento impede a leitura (desmontar antes do tick)', () => {
    const load = vi.fn();
    const cancel = deferLoad(load);
    cancel();
    vi.advanceTimersByTime(10);
    expect(load).not.toHaveBeenCalled();
  });
});

// Guarda contra a volta do problema: estes arquivos iniciam leitura de dados e não podem esperar um
// quadro de animação (a tela ficava em "Carregando…" até a aba ganhar foco; medido: Cérebro nem pedia
// /profile e /assets em 50s com a aba oculta).
describe('leitura de dados sem requestAnimationFrame', () => {
  const root = join(__dirname, '..');
  const arquivos = ['lib/hooks.ts', 'app/[marca]/page.tsx', 'app/[marca]/cerebro/page.tsx'];

  it.each(arquivos)('%s não usa requestAnimationFrame', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    expect(src).not.toMatch(/requestAnimationFrame/);
  });
});
