# Revisão do que está ultrapassado (2026-10-15)

> Método: referências cruzadas no `main` (rotas do backend × chamadas do frontend, grafo de imports, dependências do
> `package.json`, marcadores `legacy/deprecated`, modelos Prisma e arquivos soltos). **Nada foi apagado.** Cada item traz
> evidência e confiança; apagar é decisão do dono. Itens 🟡 são hipótese (pode haver uso dinâmico que a busca não vê).

## 1. Bug achado no caminho (não é só lixo)

| Item | Evidência | Ação |
|---|---|---|
| **"Pedir acesso" à marca chama uma rota que não existe** | `frontend/src/app/galeria/page.tsx:146` faz `POST /brands/:slug/access-requests`; o backend só tem `POST /brands/:slug/request-access` (`routes/brands.ts:639`). | Corrigir o caminho no frontend (ou criar o alias). |
| **Aprovar pedido de acesso não tem tela** | `POST /brands/:slug/requests/:id/approve` (`brands.ts:699`) não é chamado por nenhum arquivo do frontend. | Ou criar a tela, ou assumir que a aprovação é por outro canal e documentar. |

## 2. Código morto confirmado (sem nenhum importador em produção)

### Frontend

| Arquivo | Evidência |
|---|---|
| `components/Fabrica/PresentationWizard.tsx` | só se menciona a si mesmo |
| `components/Fabrica/RoteiroPopup.tsx` | idem |
| `components/Fabrica/Cards/AssetCard.tsx` | idem |
| `components/Fabrica/Cards/ChoiceCard.tsx` | idem |
| `hooks/useBrainSession.ts` | idem (a Fábrica usa `useFabricaWs`) |
| `hooks/useLatestRef.ts` | idem |
| `lib/googleFonts.ts` | nenhuma referência |
| `lib/shortcuts.ts` | só se menciona a si mesmo |
| dependência `react-rnd` | nenhum import |

### Backend

| Arquivo | Evidência |
|---|---|
| `src/lib/raster.ts` | nenhuma referência (SVG→PNG do "crítico multimodal" antigo) |
| `GET /brands/:slug/logo-asset` | nenhum chamador no frontend; `get_brand_kit` (MCP) cobre o logo |
| `POST /posts/render-batch` | nenhum chamador no frontend |
| dependências `@anthropic-ai/sdk`, `playwright`, `http-errors`, `@types/ws`, `@types/adm-zip` | nenhum import em `src/` nem `scripts/` 🟡 (conferir `@types/*` pelo tsc) |

## 3. Só os testes usam (código de produção que ninguém chama)

| Arquivo | Observação |
|---|---|
| `lib/competitorDiscovery.ts` | só `competitorDiscovery.test.ts` |
| `lib/generationBaseline.ts` | só o teste e o script `baselineGenerationRuns.ts` |
| `lib/designerBrain/photoAcceptance.ts` | só o teste |
| `lib/designerBrain/seeds/amandaCoelhoProfile.ts` | semente de um cliente; só teste e script `loadAmandaProfile.ts` |
| `lib/brandProfileLoad.ts` | nenhum importador em produção |
| `mcp/memoryRedis.ts` | é o Redis em memória dos testes do MCP, mas mora em `src/` de produção; mover para `__tests__/` |

## 4. Legado ainda dentro do código vivo

| Item | Evidência | Observação |
|---|---|---|
| Posts `ir-design` | `lib/postHelper.ts:68,103,137`, `routes/posts.ts:593`, nota em `renderableDeck.ts:8`: "o compilador foi deletado" | Esses posts **não renderizam mais**. Migrar (`scripts/migrate-ir-to-html.ts` existe) ou remover os ramos. |
| `legacyNotes` no perfil da marca | `lib/brandProfile.ts:88,178,238` | Compat da ficha; manter até a migração de todas as marcas. |
| "Contexto legado" no pipeline | `agents/pipeline.ts:293,335`, `lib/designerBrain/pipelineContext.ts` | Convive com o cérebro em camadas; decidir quando só o cérebro vale. |
| Comportamento "legado" de revisão (regeneração total) | `agents/brain/index.ts:404-475` | Fallback; confirmar se ainda é alcançável. |
| Campos de auto-sync em `Reference` | `prisma/schema.prisma` (comentário `DEPRECATED (2026-07)`): `autoSyncEnabled`, `autoSyncInterval`, `lastSyncedAt` | Sem leitor nem escritor desde a mudança; coluna removível por migração. |
| Modelo Gemini "legado, morto" na lista de fallback | `config.ts:85-89` | Já documentado como morto; retirar do código. |

## 5. Banco: tabelas/enum sem uso no código

| Item | Evidência |
|---|---|
| `data_deletion_requests` | nenhuma referência em `src/` (provável tabela de outro produto/LGPD) |
| `diagnostic_responses` | nenhuma referência em `src/` |
| enum `Role { ADMIN, DESIGNER }` | o app usa `BrandRole`; conferir se `User.role` ainda é lido 🟡 |

Antes de apagar tabela: confirmar com quem criou (podem ser de outro sistema no mesmo banco).

## 6. Arquivos soltos e scripts de uma vez só

| Arquivo | Data | Motivo |
|---|---|---|
| `backend/query6.ts` | 2026-07-31 | consulta pontual com `id` de post fixo |
| `backend/clean_assets.ts` | 2026-07-21 | limpeza pontual |
| `backend/canva.doc` | 2026-07-20 | 32 KB de texto de referência solto |
| `docs/create.js`, `docs/package.json`, `docs/package-lock.json` | 2026-07-18 | gerador de .docx com `npm` num repo `pnpm` |
| `images.svg` (raiz) | 2026-07-21 | arquivo avulso |
| `backend/scripts/pptx-spike.ts` | 2026-07-17 | spike |
| `backend/scripts/check-canva-config.js`, `check-canva-status.ts`, `check-prisma.cjs` | 2026-07-20 | diagnósticos pontuais |
| `backend/scripts/migrate-ir-to-html.ts` | 2026-07-18 | só serve se for migrar `ir-design`; senão obsoleto |
| `backend/scripts/teste2FotoReal.ts`, `testBrandbookExtraction.ts` | 2026-10-12 / 09-29 | testes manuais; mover para `__tests__` ou apagar |
| `code_review.md` (raiz) | 2026-07-31 | revisão pontual |

## 7. Documentação desatualizada

| Documento | Problema |
|---|---|
| `docs/PLANO-CONSOLIDACAO.md` (2026-07-20) | Diz que a biblioteca de mídia (`Asset`) é "morta" e que a geração "não lê imagem nenhuma": **já mudou** (assets, fontes e brief do MCP usam a tabela). |
| `docs/ROADMAP.md`, `docs/HANDOFF-CEREBRO-DA-IA.md` | Conferir estado contra `main`; vários itens foram entregues. |
| `GEMINI.md` | Diretrizes de julho; premissas ("ferramenta interna", "Canva como único caminho de entrega") precisam ser revistas com a publicação por link e o MCP. |
| `docs/_archive`, `docs/features`, `docs/passe3-decline-edit`, `docs/refatoracao-chat` | Já são histórico; sem índice dizendo isso. |

## 8. Ordem sugerida de limpeza (cada passo é um PR pequeno)

1. **Corrigir** `access-requests` (bug) e decidir a tela de aprovação.
2. **Remover** o código morto do §2 e as dependências sem uso (confirmando por build/tsc).
3. **Mover** `memoryRedis.ts` para `__tests__`; decidir os "só testes" do §3.
4. **Migrar ou remover** o ramo `ir-design` (§4) — o único com efeito para o usuário (posts que não abrem).
5. **Arquivos soltos** do §6 para `_archive` ou apagar.
6. **Migração de banco** (campos de `Reference`, tabelas do §5) só depois de confirmar donos.
7. **Docs**: marcar o que é histórico e atualizar `PLANO-CONSOLIDACAO.md`.
