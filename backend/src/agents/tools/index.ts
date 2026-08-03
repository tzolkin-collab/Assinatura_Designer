import { updateSession } from '../../lib/redis.js';
import { ws } from '../../lib/websocket.js';

// Único tool que sobrevive à consolidação (Fase 0): brain/index.ts e pipeline.ts
// usam 'set_design' só para persistir e broadcastar o estado cheio do design
// (html-design) no Redis/WS. Os demais tools (create_page/add_layer/etc, do
// sistema de camadas nanoBanana) foram removidos — sem chamador desde a virada
// pro html-design, ver docs/PLANO-CONSOLIDACAO.md.

import { recordStep } from '../../lib/generationTracing.js';
import { getAiContext } from '../../lib/aiContext.js';

export type DesignToolName = 'set_design';

export async function executeTool(
  tool: DesignToolName,
  args: { pages: unknown[] },
  sessionId: string,
  currentPages: unknown[],
): Promise<unknown[]> {
  const ctx = getAiContext();
  if (ctx.runId) {
    recordStep({
      runId: ctx.runId,
      kind: 'TOOL',
      name: tool,
      metadata: { argsCount: args.pages?.length, currentCount: currentPages?.length }
    });
  }

  if (tool !== 'set_design') return currentPages;

  const pages = args.pages;
  await updateSession(sessionId, { currentDesign: pages });
  ws.designUpdate(sessionId, pages);
  return pages;
}
