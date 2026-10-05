import type { rateLimit } from '../middleware/rateLimit.js';

// Configuração de rate limit COMPARTILHADA por todas as rotas que acabam chamando
// sanitizeSvg/prepareStorableFile (lib/svgSanitize.ts):
//   - POST /api/brands/:slug/brandbook/ingest      (routes/brands.ts)
//   - POST /api/brands/:slug/assets                (routes/assets.ts)
//   - POST /api/brands/:slug/assets/import-base64  (routes/assets.ts)
//   - POST /api/upload                             (routes/upload.ts)
//   - POST /api/upload/logo                        (routes/upload.ts)
//
// Por que UM objeto compartilhado (mesmo `keyPrefix`) em vez de um limite por rota:
// achado de revisão adversarial (blocker B, commit de0d9a6) — saturar o pool piscina de
// svgSanitize.ts (maxThreads=4) com só 5-6 uploads concorrentes de UMA ÚNICA conta
// (papel EDITOR, sem privilégio nenhum) faz até um SVG legítimo concorrente ser
// rejeitado por timeout junto com os adversariais. O pool é module-level — compartilhado
// pelo PROCESSO inteiro, não por conta nem por marca — então o orçamento que o CONTÉM
// também precisa ser por CONTA, não por rota: um limite separado por rota deixaria a
// mesma conta somar limite_ingest + limite_assets + limite_upload... requisições
// concorrentes contra o MESMO pool, na prática sem limite nenhum de verdade.
//
// keyBy: 'user' (não IP) — todas estas rotas já exigem requireAuth antes de chegar
// aqui (ver app.ts: `app.use('/api/brands', requireAuth, ...)` etc.), então o usuário
// autenticado é conhecido; por IP, várias contas atrás do mesmo NAT/proxy corporativo
// dividiriam o mesmo balde, e a mesma conta trocando de rede escaparia do limite.
//
// max: 4, windowSec: 10 — 4 é exatamente `SANITIZE_POOL_MAX_THREADS` (o número de
// threads de verdade do pool, ver svgSanitize.ts): uma única conta nunca consegue ter
// mais de 4 requisições admitidas dentro da janela, então mesmo no PIOR caso (as 4
// forem adversariais e lentas) elas cabem inteiras nas 4 threads sem NUNCA precisar
// enfileirar — o que evita de raiz o bug de "fila com timer que começa no
// enfileiramento" (o mesmo defeito que a rodada anterior já tinha corrigido para o
// caso de 2 chamadas, mas que voltava a aparecer acima de `maxThreads` chamadas
// concorrentes). 10s de janela é generoso para uso legítimo: um brandbook aceita até 15
// arquivos NUMA SÓ requisição HTTP (não conta como 15 aqui), e a tela de mídia só deixa
// escolher um arquivo por vez com o botão desabilitado até o upload anterior terminar
// (frontend/.../midia/page.tsx) — um humano clicando não chega perto de 4 requisições
// em 10s; um script disparando 5-6 de uma vez esbarra no limite a partir da 5ª.
export const SVG_SANITIZE_RATE_LIMIT: Parameters<typeof rateLimit>[0] = {
  windowSec: 10,
  max: 4,
  keyPrefix: 'svg-sanitize',
  keyBy: 'user',
};
